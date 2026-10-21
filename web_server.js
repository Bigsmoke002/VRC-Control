// addons/vrc-control/web_server.js

const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const WebSocket = require('ws');
const os = require('os');
const crypto = require('crypto');
const OSCManager = require('./osc_manager');

const app = express();

// Konfiguration
const CONFIG_FILE = path.join(__dirname, 'web_config.json');
const INSTANCES_FILE = path.join(__dirname, 'instances_config.json');
const CREDENTIALS_FILE = path.join(__dirname, 'credentials.json');

// Konfigurierbare Werte mit Defaults
let config = {
    host: '127.0.0.1',
    port: 4545,
    discordChannelId: "",
    adminRoleId: "",
    maxBots: 5,
    launchExePaths: {},
    startupDelay: 180000, // 3 Minuten Rate-Limit zwischen Bot-Starts
    worldPresets: {
        "Hub": "wrld_8b9b2990-7313-4430-9294-5e482036b483",
        "Hangout Spot": "wrld_4cf554b4-430c-4f8f-b53e-1f294eed230b",
        "Club Scene": "wrld_5b89c79e-c340-4510-be1b-476e9fcdfd84",
        "Game World": "wrld_6d0e89a6-d451-4c1f-a89c-5e7f1045b9c8",
        "Meeting Room": "wrld_7c1f9ab7-e562-4d2g-b9ad-6f8g2156ca9d"
    },
    osc: {
        enabled: true,
        inPort: 9001,
        host: "127.0.0.1",
        botPorts: {
            bot1: 9000,
            bot2: 9002,
            bot3: 9004,
            bot4: 9006,
            bot5: 9008
        },
        rateLimit: {
            chatbox: 1500
        }
    }
};

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
    secret: crypto.randomBytes(64).toString('hex'),
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: false,
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000
    }
}));

// WebSocket Server
const wss = new WebSocket.Server({ noServer: true });
const clients = new Set();

// Globale Variablen
let instances = {};
let systemStartTime = Date.now();
let currentCredentials = null;
let discordClient = null;
let startupQueue = [];
let isStartingBot = false;
let oscManager = null;

// Auto-Start System
let autoStartQueue = [];
let isAutoStarting = false;
let autoStartTimeoutId = null;
let lastBotStartTime = 0;

// --- Logging zu Discord ---
async function logToDiscord(action, details, user = 'System') {
    if (!discordClient || !config.discordChannelId) return;
    
    try {
        if (process.send) {
            process.send({
                type: 'discord_log',
                data: {
                    action,
                    details,
                    user,
                    timestamp: new Date().toISOString()
                }
            });
        }
    } catch (error) {
        console.error('[WebServer] Fehler beim Discord-Logging:', error);
    }
}

// --- Konfigurations-Funktionen ---
// World-ID wird in einen Shell-Befehl eingesetzt -> nur erlaubte Zeichen zulassen (verhindert Command-Injection)
function isValidWorldId(id) {
    return typeof id === 'string' && /^wrld_[0-9a-fA-F-]{36}(:[A-Za-z0-9~()_.:-]+)?$/.test(id);
}

function loadConfig() {
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            const loadedConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
            config = { ...config, ...loadedConfig };
            
            // Stelle sicher, dass alle Bot-Pfade vorhanden sind
            for (let i = 1; i <= config.maxBots; i++) {
                const botId = `bot${i}`;
                if (!config.launchExePaths[botId]) {
                    config.launchExePaths[botId] = "C:\\Program Files (x86)\\Steam\\steamapps\\common\\VRChat\\launch.exe";
                }
            }
            
            // OSC Bot-Ports sicherstellen
            if (!config.osc.botPorts) {
                config.osc.botPorts = {
                    bot1: 9000,
                    bot2: 9002,
                    bot3: 9004,
                    bot4: 9006,
                    bot5: 9008
                };
            }
            
            console.log('[WebServer] Config geladen:', {
                host: config.host,
                port: config.port,
                maxBots: config.maxBots,
                discordChannelId: config.discordChannelId ? 'gesetzt' : 'nicht gesetzt',
                oscBotPorts: Object.keys(config.osc.botPorts).length
            });
        } else {
            // Erstelle Default-Pfade für alle Bots
            for (let i = 1; i <= config.maxBots; i++) {
                const botId = `bot${i}`;
                config.launchExePaths[botId] = "C:\\Program Files (x86)\\Steam\\steamapps\\common\\VRChat\\launch.exe";
            }
            saveConfig();
            console.log('[WebServer] Neue Default-Config erstellt und gespeichert.');
        }
        
        // Lade Discord Config aus vrc_control_config.json falls vorhanden
        const vrcConfigPath = path.join(__dirname, 'vrc_control_config.json');
        if (fs.existsSync(vrcConfigPath)) {
            const vrcConfig = JSON.parse(fs.readFileSync(vrcConfigPath, 'utf8'));
            if (vrcConfig.debugLogChannelId) {
                config.discordChannelId = vrcConfig.debugLogChannelId;
            }
            if (vrcConfig.adminRoleId) {
                config.adminRoleId = vrcConfig.adminRoleId;
            }
        }
    } catch (error) {
        console.error('[WebServer] Fehler beim Laden der Konfiguration:', error);
    }
}

function saveConfig() {
    try {
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
    } catch (error) {
        console.error('[WebServer] Fehler beim Speichern der Konfiguration:', error);
    }
}

function loadInstances() {
    try {
        if (fs.existsSync(INSTANCES_FILE)) {
            const loaded = JSON.parse(fs.readFileSync(INSTANCES_FILE, 'utf8'));
            instances = loaded;
            
            // Setze Status von laufenden/startenden Instanzen zurück
            for (const [botId, instance] of Object.entries(instances)) {
                if (instance.status === 'starting' || instance.status === 'waiting_pid' || instance.status === 'running') {
                    instance.status = 'unknown';
                }
            }
            
            saveInstances();
        } else {
            // Erstelle Default-Instanzen für alle konfigurierten Bots
            instances = {};
            for (let i = 1; i <= config.maxBots; i++) {
                const botId = `bot${i}`;
                instances[botId] = {
                    name: `VRChat Bot ${i}`,
                    worldId: "",
                    pid: null,
                    startTime: null,
                    status: "stopped",
                    ram: "N/A",
                    cpu: "N/A",
                    uptime: 0
                };
            }
            saveInstances();
        }
        
        // Stelle sicher, dass alle Bots bis maxBots existieren
        for (let i = 1; i <= config.maxBots; i++) {
            const botId = `bot${i}`;
            if (!instances[botId]) {
                instances[botId] = {
                    name: `VRChat Bot ${i}`,
                    worldId: "",
                    pid: null,
                    startTime: null,
                    status: "stopped",
                    ram: "N/A",
                    cpu: "N/A",
                    uptime: 0
                };
            }
        }
        
        console.log(`[WebServer] ${Object.keys(instances).length} Bot-Instanzen geladen.`);
    } catch (error) {
        console.error('[WebServer] Fehler beim Laden der Instanzen:', error);
    }
}

function saveInstances() {
    try {
        fs.writeFileSync(INSTANCES_FILE, JSON.stringify(instances, null, 2), 'utf8');
    } catch (error) {
        console.error('[WebServer] Fehler beim Speichern der Instanzen:', error);
    }
}

// --- Credentials Management ---
function generateCredentials() {
    const username = 'admin_' + crypto.randomBytes(4).toString('hex');
    const password = crypto.randomBytes(16).toString('hex');
    const hashedPassword = bcrypt.hashSync(password, 10);
    
    currentCredentials = {
        username,
        password,
        hashedPassword,
        createdAt: Date.now(),
        expiresAt: Date.now() + 24 * 60 * 60 * 1000
    };
    
    const toSave = {
        username: currentCredentials.username,
        hashedPassword: currentCredentials.hashedPassword,
        createdAt: currentCredentials.createdAt,
        expiresAt: currentCredentials.expiresAt
    };
    
    fs.writeFileSync(CREDENTIALS_FILE, JSON.stringify(toSave, null, 2), 'utf8');
    logToDiscord('Credentials generiert', `Neuer Username: ${username}`);
    return { username, password };
}

function loadCredentials() {
    try {
        if (fs.existsSync(CREDENTIALS_FILE)) {
            const saved = JSON.parse(fs.readFileSync(CREDENTIALS_FILE, 'utf8'));
            if (saved.expiresAt > Date.now()) {
                currentCredentials = saved;
                return true;
            }
        }
    } catch (error) {
        console.error('[WebServer] Fehler beim Laden der Credentials:', error);
    }
    return false;
}

// --- Auto-Start System ---
async function startAllBotsAuto(worldPreset = null, user = 'System') {
    if (isAutoStarting) {
        throw new Error('Auto-Start läuft bereits');
    }
    
    const stoppedBots = Object.entries(instances)
        .filter(([_, instance]) => instance.status === 'stopped')
        .map(([botId, instance]) => ({ botId, instance }));
    
    if (stoppedBots.length === 0) {
        throw new Error('Keine gestoppten Bots gefunden');
    }
    
    isAutoStarting = true;
    autoStartQueue = [...stoppedBots];
    
    let defaultWorldIds = {};
    if (worldPreset && config.worldPresets && config.worldPresets[worldPreset]) {
        // Verwende das gleiche Preset für alle Bots
        for (const { botId } of stoppedBots) {
            defaultWorldIds[botId] = worldPreset;
        }
    } else {
        // Verwende individuelle World IDs oder Standard-Hub
        for (const { botId, instance } of stoppedBots) {
            defaultWorldIds[botId] = instance.worldId || 'Hub';
        }
    }
    
    await logToDiscord('Auto-Start Gestartet', 
        `Starte ${stoppedBots.length} Bots automatisch mit ${config.startupDelay/1000/60} Min Verzögerung.`, 
        user
    );
    
    // Starte ersten Bot sofort
    await processAutoStartQueue(defaultWorldIds, user);
    
    return {
        totalBots: stoppedBots.length,
        estimatedTime: (stoppedBots.length - 1) * config.startupDelay,
        worldPreset: worldPreset
    };
}

async function processAutoStartQueue(worldIds, user) {
    if (!isAutoStarting || autoStartQueue.length === 0) {
        if (isAutoStarting) {
            isAutoStarting = false;
            await logToDiscord('Auto-Start Abgeschlossen', 'Alle Bots wurden erfolgreich gestartet.', user);
            broadcastUpdate();
        }
        return;
    }
    
    const { botId, instance } = autoStartQueue.shift();
    const worldId = worldIds[botId];
    
    try {
        await logToDiscord('Auto-Start Bot', 
            `Starte ${instance.name} mit World "${worldId}" (${autoStartQueue.length} verbleibend)`, 
            user
        );
        
        await startVRChatInstance(botId, worldId, `${user} (Auto)`);
        
        // Plane nächsten Bot
        if (autoStartQueue.length > 0) {
            const remainingTime = Math.ceil(config.startupDelay / 1000 / 60);
            await logToDiscord('Auto-Start Verzögerung', 
                `Nächster Bot in ${remainingTime} Minuten. Verbleibend: ${autoStartQueue.length}`, 
                user
            );
            
            autoStartTimeoutId = setTimeout(() => {
                processAutoStartQueue(worldIds, user);
            }, config.startupDelay);
        } else {
            isAutoStarting = false;
            await logToDiscord('Auto-Start Abgeschlossen', 'Alle Bots wurden erfolgreich gestartet.', user);
        }
        
        broadcastUpdate();
    } catch (error) {
        await logToDiscord('Auto-Start Fehler', 
            `Fehler beim Starten von ${instance.name}: ${error.message}. Auto-Start wird fortgesetzt.`, 
            user
        );
        
        // Versuche nächsten Bot trotz Fehler
        if (autoStartQueue.length > 0) {
            autoStartTimeoutId = setTimeout(() => {
                processAutoStartQueue(worldIds, user);
            }, 5000); // Kurze Verzögerung bei Fehlern
        } else {
            isAutoStarting = false;
        }
    }
}

async function stopAutoStart(user = 'System') {
    if (!isAutoStarting) {
        throw new Error('Kein Auto-Start aktiv');
    }
    
    if (autoStartTimeoutId) {
        clearTimeout(autoStartTimeoutId);
        autoStartTimeoutId = null;
    }
    
    const remaining = autoStartQueue.length;
    autoStartQueue = [];
    isAutoStarting = false;
    
    await logToDiscord('Auto-Start Gestoppt', 
        `Auto-Start wurde gestoppt. ${remaining} Bots wurden übersprungen.`, 
        user
    );
    
    broadcastUpdate();
    
    return { stoppedBots: remaining };
}

function getAutoStartStatus() {
    return {
        active: isAutoStarting,
        remaining: autoStartQueue.length,
        nextBotIn: autoStartTimeoutId ? config.startupDelay : 0,
        rateLimit: config.startupDelay,
        lastStartTime: lastBotStartTime,
        timeSinceLastStart: lastBotStartTime > 0 ? Date.now() - lastBotStartTime : 0
    };
}
async function getProcessInfo(pid) {
    return new Promise((resolve) => {
        if (!pid) {
            resolve({ ram: 'N/A', cpu: 'N/A', exists: false });
            return;
        }

        exec(`tasklist /FI "PID eq ${pid}" /NH`, (error, stdout) => {
            if (error || !stdout || !stdout.toLowerCase().includes('vrchat.exe')) {
                resolve({ ram: 'N/A', cpu: 'N/A', exists: false });
                return;
            }

            let ramDone = false, cpuDone = false;
            const result = { ram: 'N/A', cpu: 'N/A', exists: true };

            const checkDone = () => {
                if (ramDone && cpuDone) resolve(result);
            };

            exec(`wmic process where processid=${pid} get workingsetsize /value`, (errRam, outRam) => {
                if (!errRam) {
                    const match = outRam.match(/WorkingSetSize=(\d+)/);
                    if (match && match[1]) {
                        const ramBytes = parseInt(match[1]);
                        if (ramBytes > 1024 * 1024 * 1024) {
                            result.ram = `${(ramBytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
                        } else {
                            result.ram = `${(ramBytes / (1024 * 1024)).toFixed(2)} MB`;
                        }
                    }
                }
                ramDone = true;
                checkDone();
            });

            result.cpu = '~?%';
            cpuDone = true;
            checkDone();
        });
    });
}

async function processStartQueue() {
    if (isStartingBot || startupQueue.length === 0) return;
    
    // Rate-Limit prüfen (3 Minuten zwischen Bot-Starts)
    const now = Date.now();
    const timeSinceLastStart = now - lastBotStartTime;
    const requiredDelay = config.startupDelay || 180000; // 3 Minuten
    
    if (lastBotStartTime > 0 && timeSinceLastStart < requiredDelay) {
        const remainingDelay = requiredDelay - timeSinceLastStart;
        await logToDiscord('Rate-Limit Aktiv', `Nächster Bot-Start in ${Math.ceil(remainingDelay / 1000)} Sekunden (EAC-Schutz).`, 'System');
        
        setTimeout(() => {
            processStartQueue();
        }, remainingDelay);
        return;
    }
    
    isStartingBot = true;
    const { botId, worldId, resolve, reject, user } = startupQueue.shift();
    
    try {
        await logToDiscord('Bot Start-Anfrage', `Starte ${instances[botId].name} (World: ${worldId || 'Default'})`, user);
        const result = await _startVRChatInstance(botId, worldId);
        lastBotStartTime = Date.now(); // Aktualisiere letzte Start-Zeit
        resolve(result);
        
        if (startupQueue.length > 0) {
            await logToDiscord('Rate-Limit Verzögerung', `Nächster Bot-Start in ${config.startupDelay/1000} Sekunden (EAC-Schutz).`, 'System');
            setTimeout(() => {
                isStartingBot = false;
                processStartQueue();
            }, config.startupDelay);
        } else {
            isStartingBot = false;
        }
    } catch (error) {
        await logToDiscord('Bot Start Fehler', `Fehler beim Starten von ${instances[botId].name}: ${error.message}`, user);
        reject(error);
        isStartingBot = false;
        processStartQueue();
    }
}

async function startVRChatInstance(botId, worldId, user = 'System') {
    return new Promise((resolve, reject) => {
        if (!instances[botId]) {
            reject(new Error(`Bot ID ${botId} nicht gefunden.`));
            return;
        }
        if (instances[botId].status === 'running' || instances[botId].status === 'starting' || instances[botId].status === 'waiting_pid') {
            reject(new Error(`${instances[botId].name} läuft bereits oder startet gerade.`));
            return;
        }
        startupQueue.push({ botId, worldId, resolve, reject, user });
        processStartQueue();
    });
}

// =================================================================================================
// KORRIGIERTER CODEBLOCK 1: _startVRChatInstance
// =================================================================================================

async function _startVRChatInstance(botId, worldId) {
    const launchPath = config.launchExePaths[botId];

    if (!launchPath || !fs.existsSync(launchPath)) {
        instances[botId].status = 'error';
        saveInstances();
        throw new Error(`launch.exe Pfad für ${botId} ('${launchPath}') nicht gefunden oder ungültig.`);
    }

    if (!worldId) {
        instances[botId].status = 'error';
        saveInstances();
        throw new Error('World ID ist erforderlich.');
    }

    let finalWorldId = worldId;
    if (config.worldPresets && config.worldPresets[worldId]) {
        finalWorldId = config.worldPresets[worldId];
        console.log(`[WebServer] Preset '${worldId}' zu '${finalWorldId}' konvertiert.`);
    }

    if (!isValidWorldId(finalWorldId)) {
        instances[botId].status = 'error';
        saveInstances();
        throw new Error('Ungültige World ID. Muss mit "wrld_" beginnen oder ein gültiges Preset sein.');
    }

    for (const [id, instance] of Object.entries(instances)) {
        if (id !== botId && instance.worldId === finalWorldId && (instance.status === 'running' || instance.status === 'waiting_pid')) {
            throw new Error(`World ID ${finalWorldId} wird bereits von ${instance.name} verwendet.`);
        }
    }

    instances[botId].worldId = finalWorldId;
    instances[botId].status = 'starting';
    instances[botId].pid = null;
    instances[botId].startTime = null;
    saveInstances();
    broadcastUpdate();

    return new Promise((resolve, reject) => {
        const windowName = `VRChat_${botId}_${Date.now()}`;
        
        // OSC-Port Anpassung
        const oscInPort = config.osc.botPorts[botId];
        if (!oscInPort) {
            reject(new Error(`Kein OSC-Eingangsport für ${botId} in der Konfiguration gefunden.`));
            return;
        }
        
        // Der Port, an den VRChat seine Daten sendet. Standardmäßig Eingangsport + 1.
        const oscOutPort = oscInPort + 1;
        
        const oscParameter = `--osc=${oscInPort}:127.0.0.1:${oscOutPort}`;
        const cmd = `start "${windowName}" "${launchPath}" -no-ht -batchmode -nographics ${oscParameter} vrchat://launch?id=${finalWorldId}`;

        console.log(`[WebServer] Starte ${botId} mit Befehl: ${cmd}`);

        exec(cmd, (error) => {
            if (error) {
                console.error(`[WebServer] Fehler beim Ausführen des Startbefehls für ${botId}:`, error);
                instances[botId].status = 'error';
                saveInstances();
                broadcastUpdate();
                reject(new Error(`Fehler beim Ausführen des Startbefehls: ${error.message}`));
                return;
            }

            instances[botId].status = 'waiting_pid';
            instances[botId].startTime = Date.now();
            saveInstances();
            broadcastUpdate();
            
            resolve(`${instances[botId].name} Startbefehl gesendet. Warte auf VRChat.exe Prozess...`);
        });
    });
}

// =================================================================================================

async function stopVRChatInstance(botId, user = 'System') {
    const instance = instances[botId];
    if (!instance) {
        throw new Error(`Bot ID ${botId} nicht gefunden.`);
    }
    if (!instance.pid) {
        if (instance.status === 'running' || instance.status === 'waiting_pid' || instance.status === 'starting') {
            await logToDiscord('Bot Stop (Aufräumen)', `${instance.name} hatte keine PID, wird als gestoppt markiert.`, user);
            instance.status = 'stopped';
            instance.startTime = null;
            saveInstances();
            broadcastUpdate();
            return 'Instanz hatte keine PID, wurde als gestoppt markiert.';
        }
        throw new Error(`${instance.name} hat keine laufende Prozess-ID zum Beenden.`);
    }

    await logToDiscord('Bot Stop Anfrage', `Stoppe ${instance.name} (PID: ${instance.pid})`, user);

    return new Promise((resolve, reject) => {
        exec(`taskkill /F /PID ${instance.pid}`, (error, stdout, stderr) => {
            if (error && !stderr.toLowerCase().includes('not found') && !stdout.toLowerCase().includes('terminated')) {
                console.error(`[WebServer] Fehler beim Stoppen von PID ${instance.pid}:`, error, stderr);
            }

            logToDiscord('Bot Gestoppt', `${instance.name} (PID: ${instance.pid}) wurde beendet oder war nicht mehr vorhanden.`, user);
            instance.pid = null;
            instance.startTime = null;
            instance.status = 'stopped';
            instance.ram = 'N/A';
            instance.cpu = 'N/A';
            saveInstances();
            broadcastUpdate();
            
            resolve(`${instance.name} erfolgreich beendet oder war nicht mehr vorhanden.`);
        });
    });
}

async function getSystemInfo() {
    const totalRam = os.totalmem();
    const freeRam = os.freemem();
    const usedRam = totalRam - freeRam;
    const cpus = os.cpus();
    
    let totalIdle = 0, totalTick = 0;
    cpus.forEach(cpu => {
        for (let type in cpu.times) {
            totalTick += cpu.times[type];
        }
        totalIdle += cpu.times.idle;
    });
    const currentCpuUsage = 100 - Math.round(100 * (totalIdle / cpus.length) / (totalTick / cpus.length));

    const systemInfo = {
        ram: {
            used: (usedRam / (1024 * 1024 * 1024)).toFixed(2),
            total: (totalRam / (1024 * 1024 * 1024)).toFixed(2),
            percentage: ((usedRam / totalRam) * 100).toFixed(1)
        },
        cpu: {
            usage: currentCpuUsage,
            cores: cpus.length,
            loadAvg: os.loadavg()[0].toFixed(2)
        },
        uptime: Date.now() - systemStartTime
    };

    const vrchatPids = await getAllVRChatPids();
    
    for (const [botId, instance] of Object.entries(instances)) {
        if (instance.status === 'waiting_pid' || instance.status === 'unknown') {
            let assignedPidThisCycle = false;
            for (const pid of vrchatPids) {
                let pidAlreadyClaimed = false;
                for (const otherInstance of Object.values(instances)) {
                    if (otherInstance.pid === pid) {
                        pidAlreadyClaimed = true;
                        break;
                    }
                }
                if (!pidAlreadyClaimed) {
                    instance.pid = pid;
                    instance.status = 'running';
                    if (!instance.startTime) instance.startTime = Date.now();
                    console.log(`[WebServer] PID ${pid} wurde ${instance.name} zugewiesen.`);
                    await logToDiscord('PID Zugewiesen', `${instance.name} (${botId}) läuft jetzt mit PID ${pid}.`);
                    assignedPidThisCycle = true;
                    break; 
                }
            }
            
            if (!assignedPidThisCycle && instance.status === 'waiting_pid') {
                const timeSinceStartAttempt = Date.now() - (instance.startTime || 0);
                if (timeSinceStartAttempt > 60000) {
                    console.log(`[WebServer] Timeout für PID-Zuweisung für ${instance.name}. Status auf error.`);
                    instance.status = 'error';
                    instance.startTime = null;
                }
            } else if (!assignedPidThisCycle && instance.status === 'unknown') {
                 instance.status = 'stopped';
            }
        }

        if (instance.pid) {
            if (vrchatPids.includes(instance.pid)) {
                const processInfo = await getProcessInfo(instance.pid);
                instance.ram = processInfo.ram;
                instance.cpu = processInfo.cpu;
                if (!processInfo.exists) {
                    instance.status = 'stopped';
                } else if (instance.status !== 'running') {
                    instance.status = 'running';
                }
            } else {
                if(instance.status === 'running') {
                    console.log(`[WebServer] PID ${instance.pid} für ${instance.name} existiert nicht mehr. Status auf gestoppt.`);
                    await logToDiscord('Prozess Verloren', `${instance.name} (PID: ${instance.pid}) nicht mehr gefunden.`, 'System');
                }
                instance.pid = null;
                instance.status = 'stopped';
                instance.startTime = null;
                instance.ram = 'N/A';
                instance.cpu = 'N/A';
            }
        } else {
            if(instance.status === 'running'){
                instance.status = 'error';
            } else if (instance.status !== 'starting' && instance.status !== 'waiting_pid' && instance.status !== 'stopped' && instance.status !== 'error') {
                 instance.status = 'stopped';
            }
            instance.ram = 'N/A';
            instance.cpu = 'N/A';
        }
        
        if (instance.startTime && instance.status === 'running') {
            instance.uptime = Date.now() - instance.startTime;
        } else {
            instance.uptime = 0;
        }
    }
    
    saveInstances();

    return {
        system: systemInfo,
        instances: instances,
        worldPresets: config.worldPresets || {}
    };
}

async function getAllVRChatPids() {
    return new Promise((resolve) => {
        exec('tasklist /FI "IMAGENAME eq VRChat.exe" /FO CSV /NH', (error, stdout) => {
            if (error || !stdout.trim()) {
                resolve([]);
                return;
            }
            
            const lines = stdout.trim().split('\n');
            const pids = [];
            
            lines.forEach(line => {
                if (line.toLowerCase().includes('vrchat.exe')) {
                    const columns = line.replace(/"/g, '').split(',');
                    if (columns.length >= 2) {
                        const pid = parseInt(columns[1]);
                        if (!isNaN(pid)) {
                            pids.push(pid);
                        }
                    }
                }
            });
            resolve(pids.sort((a, b) => a - b));
        });
    });
}

// --- Broadcast Updates ---
async function broadcastUpdate() {
    try {
        const info = await getSystemInfo();
        const message = JSON.stringify({
            type: 'update',
            data: info
        });
        
        clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(message);
            }
        });
    } catch (error) {
        console.error("[WebServer] Fehler beim Broadcast des Updates:", error);
    }
}

// --- API Routes ---
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    
    if (!currentCredentials || currentCredentials.expiresAt < Date.now()) {
        if (!loadCredentials() || currentCredentials.expiresAt < Date.now()) {
            return res.status(401).json({ error: 'Credentials abgelaufen oder nicht initialisiert.' });
        }
    }
    
    if (username !== currentCredentials.username) {
        return res.status(401).json({ error: 'Ungültiger Benutzername.' });
    }
    
    if (!bcrypt.compareSync(password, currentCredentials.hashedPassword)) {
        return res.status(401).json({ error: 'Ungültiges Passwort.' });
    }
    
    req.session.authenticated = true;
    req.session.username = username;
    res.json({ success: true });
    
    logToDiscord('Dashboard Login', `User '${username}' hat sich erfolgreich eingeloggt.`);
});

app.post('/api/logout', (req, res) => {
    const username = req.session.username || 'Unbekannt';
    req.session.destroy((err) => {
        if (err) {
            return res.status(500).json({ error: 'Fehler beim Logout.'});
        }
        res.json({ success: true });
        logToDiscord('Dashboard Logout', `User '${username}' hat sich ausgeloggt.`);
    });
});

function requireAuth(req, res, next) {
    if (!req.session.authenticated) {
        return res.status(401).json({ error: 'Nicht authentifiziert. Bitte einloggen.' });
    }
    next();
}

app.get('/api/status', requireAuth, async (req, res) => {
    try {
        const info = await getSystemInfo();
        res.json(info);
    } catch (error) {
        console.error("[WebServer] API Fehler bei /api/status:", error);
        res.status(500).json({ error: "Interner Serverfehler beim Abrufen des Status."});
    }
});

app.post('/api/instance/:botId/start', requireAuth, async (req, res) => {
    const { botId } = req.params;
    const { worldId } = req.body;
    const user = req.session.username || 'Dashboard';
    
    try {
        const result = await startVRChatInstance(botId, worldId, user);
        res.json({ success: true, message: result });
        setTimeout(broadcastUpdate, 500);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

app.post('/api/instance/:botId/stop', requireAuth, async (req, res) => {
    const { botId } = req.params;
    const user = req.session.username || 'Dashboard';
    
    try {
        const result = await stopVRChatInstance(botId, user);
        res.json({ success: true, message: result });
        broadcastUpdate();
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

app.post('/api/instance/:botId/world', requireAuth, async (req, res) => {
    const { botId } = req.params;
    const { worldId } = req.body;
    const user = req.session.username || 'Dashboard';
    
    if (!instances[botId]) {
        return res.status(404).json({ error: `Bot ID ${botId} nicht gefunden.`});
    }
    if (!worldId) {
        return res.status(400).json({ error: 'World ID ist erforderlich.' });
    }
    
    let finalWorldId = worldId;
    if (config.worldPresets && config.worldPresets[worldId]) {
        finalWorldId = config.worldPresets[worldId];
    }
    
    if (!isValidWorldId(finalWorldId)) {
        return res.status(400).json({ error: 'Ungültige World ID. Muss mit "wrld_" beginnen oder ein gültiges Preset sein.' });
    }
    
    const oldWorldId = instances[botId].worldId;
    instances[botId].worldId = finalWorldId;
    saveInstances();
    res.json({ success: true, message: `World ID für ${instances[botId].name} geändert.` });
    
    await logToDiscord('World ID Geändert', 
        `${instances[botId].name}: ${oldWorldId || '(keine)'} → ${finalWorldId}`, 
        user
    );
    
    broadcastUpdate();
});

// Auto-Start API Routes
app.post('/api/auto-start/all', requireAuth, async (req, res) => {
    const { worldPreset } = req.body;
    const user = req.session.username || 'Dashboard';
    
    try {
        const result = await startAllBotsAuto(worldPreset, user);
        res.json({ 
            success: true, 
            message: `Auto-Start für ${result.totalBots} Bots gestartet`,
            ...result
        });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

app.post('/api/auto-start/stop', requireAuth, async (req, res) => {
    const user = req.session.username || 'Dashboard';
    
    try {
        const result = await stopAutoStart(user);
        res.json({ 
            success: true, 
            message: `Auto-Start gestoppt. ${result.stoppedBots} Bots übersprungen.`,
            ...result
        });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

app.get('/api/auto-start/status', requireAuth, (req, res) => {
    const status = getAutoStartStatus();
    res.json(status);
});

// --- OSC API Routes ---
app.get('/api/osc/status', requireAuth, (req, res) => {
    try {
        if (!oscManager) {
            return res.json({ connected: false, error: 'OSC Manager nicht initialisiert' });
        }
        res.json(oscManager.getStatus());
    } catch (error) {
        console.error("[WebServer] OSC Status Fehler:", error);
        res.status(500).json({ error: "Fehler beim Abrufen des OSC-Status" });
    }
});

// Single Bot Chatbox
app.post('/api/osc/chatbox/send', requireAuth, (req, res) => {
    const { botId, message, immediate = true, notification = true } = req.body;
    const user = req.session.username || 'Dashboard';
    
    if (!oscManager) {
        return res.status(400).json({ error: 'OSC Manager nicht verfügbar' });
    }
    
    if (!botId || !message) {
        return res.status(400).json({ error: 'botId und message sind erforderlich' });
    }
    
    try {
        const success = oscManager.sendChatboxMessage(botId, message, immediate, notification);
        
        if (success) {
            logToDiscord('OSC Chatbox', `${user} sendete Nachricht für ${botId}: "${message}"`, user);
            res.json({ success: true, message: 'Chatbox-Nachricht gesendet' });
        } else {
            res.status(400).json({ error: 'Fehler beim Senden der Chatbox-Nachricht' });
        }
    } catch (error) {
        console.error("[WebServer] OSC Chatbox Fehler:", error);
        res.status(500).json({ error: "Interner Serverfehler" });
    }
});

// Multi-Bot Chatbox
app.post('/api/osc/chatbox/send/multi', requireAuth, (req, res) => {
    const { botIds, message, immediate = true, notification = true } = req.body;
    const user = req.session.username || 'Dashboard';
    
    if (!oscManager) {
        return res.status(400).json({ error: 'OSC Manager nicht verfügbar' });
    }
    
    if (!botIds || !Array.isArray(botIds) || botIds.length === 0 || !message) {
        return res.status(400).json({ error: 'botIds (Array) und message sind erforderlich' });
    }
    
    try {
        const results = oscManager.sendMultiBotChatboxMessage(botIds, message, immediate, notification);
        
        logToDiscord('OSC Multi-Bot Chatbox', `${user} sendete Nachricht für [${botIds.join(', ')}]: "${message}"`, user);
        res.json({ success: true, message: 'Multi-Bot Chatbox-Nachricht gesendet', results });
    } catch (error) {
        console.error("[WebServer] OSC Multi-Bot Chatbox Fehler:", error);
        res.status(500).json({ error: "Interner Serverfehler" });
    }
});

// Single Bot Loop
app.post('/api/osc/chatbox/loop/start', requireAuth, (req, res) => {
    const { botId, template, interval = 5000, customMessage } = req.body;
    const user = req.session.username || 'Dashboard';
    
    if (!oscManager) {
        return res.status(400).json({ error: 'OSC Manager nicht verfügbar' });
    }
    
    if (!botId) {
        return res.status(400).json({ error: 'botId ist erforderlich' });
    }
    
    try {
        let messageFunction;
        
        if (customMessage) {
            messageFunction = () => customMessage;
        } else if (template) {
            const context = {
                botId: botId,
                uptime: instances[botId] ? instances[botId].uptime : 0
            };
            messageFunction = oscManager.createTemplateFunction(template, context);
            
            if (!messageFunction) {
                return res.status(400).json({ error: 'Unbekanntes Template' });
            }
        } else {
            return res.status(400).json({ error: 'Template oder customMessage erforderlich' });
        }
        
        const success = oscManager.startChatboxLoop(botId, messageFunction, interval);
        
        if (success) {
            logToDiscord('OSC Chatbox Loop', `${user} startete Chatbox-Loop für ${botId} (${template || 'custom'})`, user);
            res.json({ success: true, message: 'Chatbox-Loop gestartet' });
        } else {
            res.status(400).json({ error: 'Fehler beim Starten des Chatbox-Loops' });
        }
    } catch (error) {
        console.error("[WebServer] OSC Chatbox Loop Fehler:", error);
        res.status(500).json({ error: "Interner Serverfehler" });
    }
});

// =================================================================================================
// KORRIGIERTER CODEBLOCK 2: Multi-Bot Loop API
// =================================================================================================

app.post('/api/osc/chatbox/loop/start/multi', requireAuth, (req, res) => {
    const { botIds, template, interval = 5000, customMessage } = req.body;
    const user = req.session.username || 'Dashboard';
    
    if (!oscManager) {
        return res.status(400).json({ error: 'OSC Manager nicht verfügbar' });
    }
    
    if (!botIds || !Array.isArray(botIds) || botIds.length === 0) {
        return res.status(400).json({ error: 'botIds (Array) ist erforderlich' });
    }

    if (!template || customMessage) {
        return res.status(400).json({ error: 'Für Multi-Loops muss ein Template ausgewählt werden (keine Custom Message).' });
    }

    try {
        // Übergebe den Template-Namen und die aktuellen Instanzdaten direkt an den OSC Manager
        const loopId = oscManager.startMultiBotChatboxLoop(botIds, template, interval, instances);
        
        if (loopId) {
            logToDiscord('OSC Multi-Bot Loop', `${user} startete Multi-Bot Chatbox-Loop für [${botIds.join(', ')}] (${template})`, user);
            res.json({ success: true, message: 'Multi-Bot Chatbox-Loop gestartet', loopId });
        } else {
            res.status(400).json({ error: 'Fehler beim Starten des Multi-Bot Chatbox-Loops' });
        }
    } catch (error) {
        console.error("[WebServer] OSC Multi-Bot Loop Fehler:", error);
        res.status(500).json({ error: "Interner Serverfehler" });
    }
});

// =================================================================================================


app.post('/api/osc/chatbox/loop/stop', requireAuth, (req, res) => {
    const { botId, loopId } = req.body;
    const user = req.session.username || 'Dashboard';
    
    if (!oscManager) {
        return res.status(400).json({ error: 'OSC Manager nicht verfügbar' });
    }
    
    try {
        let success = false;
        
        if (loopId) {
            // Multi-Bot Loop stoppen
            success = oscManager.stopMultiBotChatboxLoop(loopId);
            if (success) {
                logToDiscord('OSC Multi-Bot Loop Stop', `${user} stoppte Multi-Bot Chatbox-Loop: ${loopId}`, user);
            }
        } else if (botId) {
            // Single Bot Loop stoppen
            success = oscManager.stopChatboxLoop(botId);
            if (success) {
                logToDiscord('OSC Chatbox Loop Stop', `${user} stoppte Chatbox-Loop für ${botId}`, user);
            }
        }
        
        if (success) {
            res.json({ success: true, message: 'Chatbox-Loop gestoppt' });
        } else {
            res.json({ success: true, message: 'Kein aktiver Chatbox-Loop gefunden' });
        }
    } catch (error) {
        console.error("[WebServer] OSC Chatbox Loop Stop Fehler:", error);
        res.status(500).json({ error: "Interner Serverfehler" });
    }
});

// Template Management
app.get('/api/osc/templates', requireAuth, (req, res) => {
    try {
        if (!oscManager) {
            return res.json({ builtin: {}, custom: {} });
        }
        
        const builtIn = Object.keys(oscManager.getBuiltInChatboxTemplates());
        const customTemplates = Array.from(oscManager.customTemplates.entries()).map(([name, template]) => ({
            name,
            content: template.content,
            description: template.description,
            created: template.created
        }));
        
        res.json({
            builtin: builtIn,
            custom: customTemplates
        });
    } catch (error) {
        console.error("[WebServer] OSC Templates Fehler:", error);
        res.status(500).json({ error: "Fehler beim Laden der Templates" });
    }
});

app.post('/api/osc/templates/custom', requireAuth, (req, res) => {
    const { name, content, description = '' } = req.body;
    const user = req.session.username || 'Dashboard';
    
    if (!oscManager) {
        return res.status(400).json({ error: 'OSC Manager nicht verfügbar' });
    }
    
    if (!name || !content) {
        return res.status(400).json({ error: 'Name und Content sind erforderlich' });
    }
    
    try {
        const success = oscManager.saveCustomTemplate(name, content, description);
        
        if (success) {
            logToDiscord('OSC Template Erstellt', `${user} erstellte Custom Template: ${name}`, user);
            res.json({ success: true, message: 'Custom Template gespeichert' });
        } else {
            res.status(400).json({ error: 'Fehler beim Speichern des Templates (Name/Content zu lang?)' });
        }
    } catch (error) {
        console.error("[WebServer] OSC Template Save Fehler:", error);
        res.status(500).json({ error: "Interner Serverfehler" });
    }
});

app.delete('/api/osc/templates/custom/:name', requireAuth, (req, res) => {
    const { name } = req.params;
    const user = req.session.username || 'Dashboard';
    
    if (!oscManager) {
        return res.status(400).json({ error: 'OSC Manager nicht verfügbar' });
    }
    
    try {
        const success = oscManager.deleteCustomTemplate(name);
        
        if (success) {
            logToDiscord('OSC Template Gelöscht', `${user} löschte Custom Template: ${name}`, user);
            res.json({ success: true, message: 'Custom Template gelöscht' });
        } else {
            res.status(404).json({ error: 'Template nicht gefunden' });
        }
    } catch (error) {
        console.error("[WebServer] OSC Template Delete Fehler:", error);
        res.status(500).json({ error: "Interner Serverfehler" });
    }
});

app.get('/api/osc/loops', requireAuth, (req, res) => {
    try {
        if (!oscManager) {
            return res.json({ loops: [] });
        }
        
        const loops = oscManager.getLoopDetails();
        res.json({ loops });
    } catch (error) {
        console.error("[WebServer] OSC Loops Fehler:", error);
        res.status(500).json({ error: "Fehler beim Laden der Loop-Details" });
    }
});

// --- Server Setup ---
if (require.main === module) {
    const net = require('net');
    
    loadConfig();
    const PORT = config.port;
    const HOST = config.host;
    
    const testServer = net.createServer();
    
    testServer.once('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            console.error(`[WebServer] Port ${PORT} auf Host ${HOST} ist bereits belegt!`);
            console.log('[WebServer] Stelle sicher, dass keine andere Instanz läuft oder verwende cleanup_port.js/.bat.');
            process.exit(1);
        }
    });
    
    testServer.once('listening', () => {
        testServer.close(async () => {
            const server = app.listen(PORT, HOST, async () => {
                console.log(`[WebServer] Server läuft auf http://${HOST}:${PORT}`);
                
                loadInstances();
                
                // OSC Manager initialisieren
                try {
                    oscManager = new OSCManager();
                    if (config.osc.botPorts) {
                        oscManager.config.botPorts = config.osc.botPorts;
                    }
                    console.log('[WebServer] Multi-Bot OSC Manager initialisiert');
                } catch (error) {
                    console.error('[WebServer] Fehler beim Initialisieren des OSC Managers:', error);
                }
                
                console.log('[WebServer] Prüfe auf laufende VRChat-Prozesse beim Start...');
                try {
                    const runningPids = await getAllVRChatPids();
                    if (runningPids.length > 0) {
                        console.log(`[WebServer] Beim Start gefundene VRChat PIDs: ${runningPids.join(', ')}.`);
                    } else {
                        console.log('[WebServer] Keine laufenden VRChat-Prozesse beim Start gefunden.');
                    }
                } catch (error) {
                    console.error('[WebServer] Fehler beim Abrufen der VRChat PIDs beim Serverstart:', error);
                }
                
                if (!loadCredentials() || (currentCredentials && currentCredentials.expiresAt < Date.now())) {
                    const creds = generateCredentials();
                    console.log('\n=================================');
                    console.log('Neue Login-Daten generiert (gültig für 24h):');
                    console.log(`Username: ${creds.username}`);
                    console.log(`Password: ${creds.password}`);
                    console.log('=================================\n');
                    
                    if (process.send) {
                        process.send({
                            type: 'credentials',
                            data: { username: creds.username, password: creds.password }
                        });
                    }
                } else {
                     console.log('[WebServer] Gültige Credentials geladen.');
                }
                
                broadcastUpdate();
                setInterval(broadcastUpdate, 5000);
            });

            server.on('upgrade', (request, socket, head) => {
                const pathname = request.url;
                
                if (pathname === '/ws') {
                    wss.handleUpgrade(request, socket, head, (ws) => {
                        wss.emit('connection', ws, request);
                    });
                } else {
                    socket.destroy();
                }
            });

            wss.on('connection', async (ws) => {
                clients.add(ws);
                console.log('[WebServer] WebSocket Client verbunden. Gesamtzahl Clients:', clients.size);
                
                ws.on('close', () => {
                    clients.delete(ws);
                    console.log('[WebServer] WebSocket Client getrennt. Gesamtzahl Clients:', clients.size);
                });
                
                ws.on('error', (error) => {
                    console.error('[WebServer] WebSocket Client Fehler:', error);
                    clients.delete(ws);
                });
                
                try {
                    const info = await getSystemInfo();
                    ws.send(JSON.stringify({
                        type: 'update',
                        data: info
                    }));
                } catch (error) {
                    console.error("[WebServer] Fehler beim Senden des initialen WS Updates:", error);
                }
            });
            
            if (process.send) {
                process.on('message', (message) => {
                    if (message.type === 'generateCredentials') {
                        const creds = generateCredentials();
                        process.send({
                            type: 'credentials',
                            data: creds
                        });
                    } else if (message.type === 'setDiscordClient') {
                        discordClient = true;
                        console.log('[WebServer] Discord Client als verfügbar markiert durch Parent.');
                    }
                });
            }
            
            const shutdown = (signal) => {
                console.log(`[WebServer] ${signal} empfangen, fahre herunter...`);
                
                // OSC Manager cleanup
                if (oscManager) {
                    oscManager.cleanup();
                }
                
                wss.close(() => {
                    console.log('[WebServer] WebSocket Server geschlossen.');
                });
                server.close(() => {
                    console.log('[WebServer] HTTP Server geschlossen.');
                    process.exit(0);
                });
                setTimeout(() => {
                    console.error('[WebServer] Graceful Shutdown Timeout. Beende Prozess hart.');
                    process.exit(1);
                }, 5000);
            };

            process.on('SIGTERM', () => shutdown('SIGTERM'));
            process.on('SIGINT', () => shutdown('SIGINT'));
        });
    });
    
    testServer.listen(PORT, HOST);
}

module.exports = {};