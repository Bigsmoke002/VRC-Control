// addons/vrc-control/osc_manager.js
// Erweiterter OSC-Manager für VRChat Control System mit Multi-Bot Support

const dgram = require('dgram');
const path = require('path');
const fs = require('fs');

class OSCManager {
    constructor() {
        this.clients = new Map();
        this.server = null;
        this.liveInstances = {}; // NEU: Speicher für Live-Daten
        this.config = {
            inPort: 9001,
            host: '127.0.0.1',
            botPorts: {
                bot1: 9000,
                bot2: 9002,
                bot3: 9004,
                bot4: 9006,
                bot5: 9008
            }
        };
        this.chatboxRateLimit = new Map();
        this.chatLoops = new Map();
        this.customTemplates = new Map();
        this.init();
        this.loadCustomTemplates();
    }

    // NEUE FUNKTION: Aktualisiert den internen Status der Instanzen
    updateLiveInstances(instances) {
        this.liveInstances = instances;
    }
    
    init() {
        try {
            for (const [botId, port] of Object.entries(this.config.botPorts)) {
                const client = dgram.createSocket('udp4');
                this.clients.set(botId, { client, port });
                this.chatboxRateLimit.set(botId, { lastSent: 0, minInterval: 1500, queue: [] });
            }
            this.server = dgram.createSocket('udp4');
            this.server.on('message', (msg, rinfo) => {
                try {
                    this.handleIncomingOSC(msg, rinfo);
                } catch (error) {
                    console.error('[OSCManager] Fehler beim Verarbeiten eingehender OSC-Nachricht:', error);
                }
            });
            this.server.on('error', (err) => console.error('[OSCManager] Server-Fehler:', err));
            this.startRateLimitProcessing();
            console.log('[OSCManager] ✅ Multi-Bot OSC-Manager initialisiert');
            console.log(`[OSCManager] 📤 Bot-Ports:`, this.config.botPorts);
            console.log(`[OSCManager] 📥 Höre auf: ${this.config.inPort}`);
        } catch (error) {
            console.error('[OSCManager] ❌ Initialisierung fehlgeschlagen:', error);
        }
    }
    
    buildOSCMessage(address, args = []) {
        const addressBuffer = Buffer.from(address + '\0');
        const typetagBuffer = Buffer.from(',' + args.map(arg => {
            if (typeof arg === 'string') return 's';
            if (typeof arg === 'number') return Number.isInteger(arg) ? 'i' : 'f';
            if (typeof arg === 'boolean') return arg ? 'T' : 'F';
            return 's';
        }).join('') + '\0');
        const argBuffers = args.map(arg => {
            if (typeof arg === 'string') {
                const str = arg + '\0';
                const buf = Buffer.alloc(Math.ceil(str.length / 4) * 4);
                buf.write(str);
                return buf;
            }
            if (typeof arg === 'number') {
                const buf = Buffer.alloc(4);
                Number.isInteger(arg) ? buf.writeInt32BE(arg) : buf.writeFloatBE(arg);
                return buf;
            }
            return Buffer.alloc(0);
        });
        return Buffer.concat([
            this.padToMultiple(addressBuffer, 4),
            this.padToMultiple(typetagBuffer, 4),
            ...argBuffers.map(buf => this.padToMultiple(buf, 4))
        ]);
    }
    
    padToMultiple(buffer, multiple) {
        const remainder = buffer.length % multiple;
        if (remainder === 0) return buffer;
        const padding = multiple - remainder;
        return Buffer.concat([buffer, Buffer.alloc(padding)]);
    }
    
    sendMessageToBot(botId, address, args = []) {
        try {
            const botClient = this.clients.get(botId);
            if (!botClient) {
                console.error(`[OSCManager] Bot ${botId} nicht gefunden`);
                return false;
            }
            const message = this.buildOSCMessage(address, args);
            botClient.client.send(message, botClient.port, this.config.host, (err) => {
                if (err) console.error(`[OSCManager] Fehler beim Senden an ${botId}:`, err);
            });
            return true;
        } catch (error) {
            console.error(`[OSCManager] Fehler beim Erstellen der Nachricht für ${botId}:`, error);
            return false;
        }
    }
    
    sendMessageToMultipleBots(botIds, address, args = []) {
        return botIds.map(botId => ({ botId, success: this.sendMessageToBot(botId, address, args) }));
    }
    
    sendChatboxMessage(botId, text, immediate = true, notification = true) {
        if (!text || text.length === 0) return false;
        if (text.length > 144) text = text.substring(0, 141) + '...';
        const message = { botId, address: '/chatbox/input', args: [text, immediate, notification], timestamp: Date.now() };
        const rateLimit = this.chatboxRateLimit.get(botId);
        if (rateLimit) rateLimit.queue.push(message);
        return true;
    }
    
    sendMultiBotChatboxMessage(botIds, text, immediate = true, notification = true) {
        return botIds.map(botId => ({ botId, success: this.sendChatboxMessage(botId, text, immediate, notification) }));
    }
    
    startChatboxLoop(botId, messageFunction, interval = 5000) {
        this.stopChatboxLoop(botId);
        const loop = setInterval(() => {
            try {
                const message = messageFunction();
                if (message) this.sendChatboxMessage(botId, message, true, false);
            } catch (error) {
                console.error(`[OSCManager] Fehler in Chatbox-Loop für ${botId}:`, error);
            }
        }, Math.max(interval, 2000));
        this.chatLoops.set(botId, { interval, function: messageFunction, intervalMs: interval, type: 'single' });
        console.log(`[OSCManager] 🔄 Chatbox-Loop gestartet für ${botId} (${interval}ms)`);
        return true;
    }

    // ANGEPASSTE FUNKTION
    startMultiBotChatboxLoop(botIds, templateName, interval = 5000) {
        const loopId = `multi_${botIds.join('_')}`;
        this.stopMultiBotChatboxLoop(loopId);
        const loop = setInterval(() => {
            try {
                for (const botId of botIds) {
                    const context = {
                        botId: botId,
                        uptime: this.liveInstances[botId] ? this.liveInstances[botId].uptime : 0
                    };
                    const messageFunction = this.createTemplateFunction(templateName, context);
                    const message = messageFunction ? messageFunction() : null;
                    if (message) this.sendChatboxMessage(botId, message, true, false);
                }
            } catch (error) {
                console.error(`[OSCManager] Fehler in Multi-Bot Chatbox-Loop:`, error);
            }
        }, Math.max(interval, 2000));
        this.chatLoops.set(loopId, { interval, intervalMs: interval, type: 'multi', botIds });
        console.log(`[OSCManager] 🔄 Multi-Bot Chatbox-Loop gestartet für [${botIds.join(', ')}] (${interval}ms)`);
        return loopId;
    }

    stopChatboxLoop(botId) {
        const loop = this.chatLoops.get(botId);
        if (loop && loop.type === 'single') {
            clearInterval(loop.interval);
            this.chatLoops.delete(botId);
            console.log(`[OSCManager] ⏹️ Chatbox-Loop gestoppt für ${botId}`);
            return true;
        }
        return false;
    }
    
    stopMultiBotChatboxLoop(loopId) {
        const loop = this.chatLoops.get(loopId);
        if (loop && loop.type === 'multi') {
            clearInterval(loop.interval);
            this.chatLoops.delete(loopId);
            console.log(`[OSCManager] ⏹️ Multi-Bot Chatbox-Loop gestoppt: ${loopId}`);
            return true;
        }
        return false;
    }
    
    stopAllChatboxLoops() {
        for (const [, loop] of this.chatLoops) clearInterval(loop.interval);
        this.chatLoops.clear();
        console.log(`[OSCManager] ⏹️ Alle Chatbox-Loops gestoppt`);
    }
    
    getBuiltInChatboxTemplates() {
        return {
            'time': () => `🕐 ${new Date().toLocaleTimeString('de-DE')}`,
            'date': () => `📅 ${new Date().toLocaleDateString('de-DE')}`,
            'datetime': () => `🕐 ${new Date().toLocaleString('de-DE')}`,
            'uptime': (startTime) => {
                const uptime = Date.now() - startTime;
                const hours = Math.floor(uptime / 3600000);
                const minutes = Math.floor((uptime % 3600000) / 60000);
                return `⏱️ Uptime: ${hours}h ${minutes}m`;
            },
            'system': () => `💻 RAM: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)} MB`,
            'heartbeat': () => `💓 ${new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`,
            'status': (status) => `📊 Status: ${status}`,
            'world': (worldId) => `🌍 World: ${worldId.split(':')[0].replace('wrld_', '')}`,
            'counter': (start = 0) => {
                let count = start;
                return () => `🔢 Counter: ${++count}`;
            }
        };
    }
    
    getAllChatboxTemplates() {
        const builtIn = this.getBuiltInChatboxTemplates();
        const templates = { ...builtIn };
        for (const [name, template] of this.customTemplates) {
            templates[name] = template.function || (() => template.content);
        }
        return templates;
    }
    
    saveCustomTemplate(name, content, description = '') {
        if (!name || !content || name.length > 50 || content.length > 200) return false;
        this.customTemplates.set(name, { name, content, description, created: new Date().toISOString(), type: 'custom' });
        this.saveCustomTemplatesToFile();
        console.log(`[OSCManager] Custom Template '${name}' gespeichert`);
        return true;
    }
    
    deleteCustomTemplate(name) {
        if (this.customTemplates.has(name)) {
            this.customTemplates.delete(name);
            this.saveCustomTemplatesToFile();
            console.log(`[OSCManager] Custom Template '${name}' gelöscht`);
            return true;
        }
        return false;
    }
    
    loadCustomTemplates() {
        try {
            const templatesFile = path.join(__dirname, 'custom_templates.json');
            if (fs.existsSync(templatesFile)) {
                const data = JSON.parse(fs.readFileSync(templatesFile, 'utf8'));
                this.customTemplates = new Map(Object.entries(data));
                console.log(`[OSCManager] ${this.customTemplates.size} Custom Templates geladen`);
            }
        } catch (error) {
            console.error('[OSCManager] Fehler beim Laden der Custom Templates:', error);
        }
    }
    
    saveCustomTemplatesToFile() {
        try {
            const templatesFile = path.join(__dirname, 'custom_templates.json');
            const data = Object.fromEntries(this.customTemplates);
            fs.writeFileSync(templatesFile, JSON.stringify(data, null, 2));
        } catch (error) {
            console.error('[OSCManager] Fehler beim Speichern der Custom Templates:', error);
        }
    }
    
    createTemplateFunction(templateName, context = {}) {
        const templates = this.getAllChatboxTemplates();
        const template = templates[templateName];
        if (!template) return null;
        if (typeof template === 'function') return template;
        if (this.customTemplates.has(templateName)) {
            const customTemplate = this.customTemplates.get(templateName);
            return () => {
                let content = customTemplate.content;
                content = content.replace(/\{time\}/g, new Date().toLocaleTimeString('de-DE'));
                content = content.replace(/\{date\}/g, new Date().toLocaleDateString('de-DE'));
                content = content.replace(/\{datetime\}/g, new Date().toLocaleString('de-DE'));
                if (context.botId) {
                    content = content.replace(/\{bot\}/g, context.botId);
                }
                if (context.uptime) {
                    const hours = Math.floor(context.uptime / 3600000);
                    const minutes = Math.floor((context.uptime % 3600000) / 60000);
                    content = content.replace(/\{uptime\}/g, `Uptime: ${hours}h ${minutes}m`);
                }
                return content;
            };
        }
        return () => String(template);
    }
    
    startRateLimitProcessing() {
        setInterval(() => {
            for (const [botId, rateLimit] of this.chatboxRateLimit) {
                if (rateLimit.queue.length > 0) {
                    const now = Date.now();
                    if (now - rateLimit.lastSent >= rateLimit.minInterval) {
                        const message = rateLimit.queue.shift();
                        this.sendMessageToBot(botId, message.address, message.args);
                        rateLimit.lastSent = now;
                    }
                }
            }
        }, 100);
    }
    
    handleIncomingOSC(msg, rinfo) {
        try {
            const message = this.parseOSCMessage(msg);
            console.log(`[OSCManager] 📥 Empfangen von ${rinfo.address}:${rinfo.port}:`, message);
        } catch (error) {
            console.error('[OSCManager] Fehler beim Parsen eingehender OSC-Nachricht:', error);
        }
    }
    
    parseOSCMessage(buffer) {
        let offset = 0;
        const addressEnd = buffer.indexOf(0, offset);
        const address = buffer.toString('utf8', offset, addressEnd);
        offset = Math.ceil((addressEnd + 1) / 4) * 4;
        const typetagEnd = buffer.indexOf(0, offset);
        const typetag = buffer.toString('utf8', offset + 1, typetagEnd);
        offset = Math.ceil((typetagEnd + 1) / 4) * 4;
        const args = [];
        for (const type of typetag) {
            switch (type) {
                case 'i': args.push(buffer.readInt32BE(offset)); offset += 4; break;
                case 'f': args.push(buffer.readFloatBE(offset)); offset += 4; break;
                case 's':
                    const stringEnd = buffer.indexOf(0, offset);
                    args.push(buffer.toString('utf8', offset, stringEnd));
                    offset = Math.ceil((stringEnd + 1) / 4) * 4;
                    break;
                case 'T': args.push(true); break;
                case 'F': args.push(false); break;
            }
        }
        return { address, args };
    }
    
    getStatus() {
        const totalQueue = Array.from(this.chatboxRateLimit.values()).reduce((sum, rateLimit) => sum + rateLimit.queue.length, 0);
        return {
            connected: this.clients.size > 0,
            config: this.config,
            botPorts: this.config.botPorts,
            chatboxQueue: totalQueue,
            activeChatLoops: this.chatLoops.size,
            chatLoops: Array.from(this.chatLoops.keys()),
            customTemplates: Array.from(this.customTemplates.keys()),
            totalCustomTemplates: this.customTemplates.size
        };
    }
    
    getLoopDetails() {
        const loops = [];
        for (const [loopId, loop] of this.chatLoops) {
            loops.push({ id: loopId, type: loop.type, interval: loop.intervalMs, botIds: loop.type === 'multi' ? loop.botIds : [loopId] });
        }
        return loops;
    }
    
    cleanup() {
        try {
            this.stopAllChatboxLoops();
            for (const [, botClient] of this.clients) {
                botClient.client.close();
            }
            this.clients.clear();
            if (this.server) this.server.close();
            console.log('[OSCManager] 🧹 Multi-Bot Cleanup abgeschlossen');
        } catch (error) {
            console.error('[OSCManager] Fehler beim Cleanup:', error);
        }
    }
}

module.exports = OSCManager;