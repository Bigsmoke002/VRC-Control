// addons/vrc-control/cmd_vrchatcontrol.js

const {
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    MessageFlags,
    StringSelectMenuBuilder,
} = require('discord.js');
const path = require('path');
const { fork } = require('child_process');
const fs = require('fs');

// Web Server als Child Process
let webServerProcess = null;
let currentCredentials = null;
let config = null;

// Public dashboard URL shown in Discord (set VRC_DASHBOARD_URL for a reverse-proxy domain)
const DASHBOARD_URL = process.env.VRC_DASHBOARD_URL || 'http://localhost:4545';

// Eindeutige IDs für Buttons um Kollisionen zu vermeiden
const BUTTON_IDS = {
    REFRESH_CREDS: 'vrchat_ctrl_refresh_creds',
    SHOW_STATUS: 'vrchat_ctrl_show_status',
    MULTI_CHATBOX: 'vrchat_ctrl_multi_chatbox',
    OSC_STATUS: 'vrchat_ctrl_osc_status',
    TEMPLATE_MANAGER: 'vrchat_ctrl_template_manager'
};

// Lade Config
function loadConfig() {
    try {
        const configPath = path.join(__dirname, 'web_config.json');
        const vrcConfigPath = path.join(__dirname, 'vrc_control_config.json');
        
        // Lade Web Config
        if (fs.existsSync(configPath)) {
            config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        } else {
            config = {
                host: '0.0.0.0',
                port: 4545,
                maxBots: 5
            };
        }
        
        // Lade VRC Config für Discord Channel
        if (fs.existsSync(vrcConfigPath)) {
            const vrcConfig = JSON.parse(fs.readFileSync(vrcConfigPath, 'utf8'));
            config.discordChannelId = vrcConfig.debugLogChannelId || "";
            config.adminRoleId = vrcConfig.adminRoleId || "";
        }
        
        return config;
    } catch (error) {
        console.error('[VRChatControl] Fehler beim Laden der Config:', error);
        return {
            host: '0.0.0.0',
            port: 4545,
            maxBots: 5
        };
    }
}

// Starte den Web Server
function startWebServer(client) {
    const webServerPath = path.join(__dirname, 'web_server.js');
    
    if (!fs.existsSync(webServerPath)) {
        console.error('[VRChatControl] web_server.js nicht gefunden!');
        return;
    }
    
    // Beende alten Prozess falls vorhanden
    if (webServerProcess) {
        console.log('[VRChatControl] Beende alten Web Server Prozess...');
        webServerProcess.kill();
        webServerProcess = null;
    }
    
    console.log('[VRChatControl] Starte Web Server...');
    webServerProcess = fork(webServerPath, [], {
        detached: false,
        silent: false
    });
    
    webServerProcess.on('message', async (message) => {
        if (message.type === 'credentials') {
            currentCredentials = message.data;
            console.log('[VRChatControl] Neue Credentials vom Server erhalten');
        } else if (message.type === 'discord_log' && client && config.discordChannelId) {
            // Verbesserte Discord-Logging mit Fehlerbehandlung
            try {
                // Prüfe zuerst, ob der Bot Zugriff auf den Channel hat
                const channel = await client.channels.fetch(config.discordChannelId).catch(() => null);
                
                if (!channel) {
                    console.warn(`[VRChatControl] Kann Channel ${config.discordChannelId} nicht erreichen - prüfe Bot-Berechtigungen`);
                    return;
                }
                
                // Prüfe Berechtigungen
                const botMember = channel.guild?.members?.cache?.get(client.user.id);
                if (botMember && !channel.permissionsFor(botMember).has(['ViewChannel', 'SendMessages'])) {
                    console.warn(`[VRChatControl] Bot hat keine Berechtigung für Channel ${config.discordChannelId}`);
                    return;
                }
                
                const timestamp = new Date(message.data.timestamp).toLocaleString('de-DE', { 
                    timeZone: 'Europe/Berlin', 
                    dateStyle: 'short', 
                    timeStyle: 'medium' 
                });
                
                const embed = new EmbedBuilder()
                    .setColor(0x8A2BE2)
                    .setTitle('⚙️ VRC Web Control - Log')
                    .addFields(
                        { name: 'Zeit', value: timestamp, inline: true },
                        { name: 'User', value: message.data.user || 'System', inline: true },
                        { name: 'Aktion', value: message.data.action, inline: false }
                    )
                    .setTimestamp();
                
                if (message.data.details) {
                    embed.addFields({ 
                        name: 'Details', 
                        value: message.data.details.substring(0, 1020), 
                        inline: false 
                    });
                }
                
                await channel.send({ embeds: [embed] });
            } catch (error) {
                // Nur bei unerwarteten Fehlern loggen
                if (error.code !== 50001) { // Missing Access
                    console.error('[VRChatControl] Unerwarteter Fehler beim Discord-Logging:', error);
                }
            }
        }
    });
    
    webServerProcess.on('error', (error) => {
        console.error('[VRChatControl] Web Server Fehler:', error);
    });
    
    webServerProcess.on('exit', (code) => {
        console.log(`[VRChatControl] Web Server beendet mit Code ${code}`);
        webServerProcess = null;
        
        if (code !== 0) {
            console.log('[VRChatControl] Starte Web Server in 5 Sekunden neu...');
            setTimeout(() => startWebServer(client), 5000);
        }
    });
    
    // Teile dem Server mit, dass Discord verfügbar ist
    setTimeout(() => {
        if (webServerProcess) {
            webServerProcess.send({ type: 'setDiscordClient' });
        }
    }, 1000);
}

// Funktion zum Generieren neuer Credentials
async function generateNewCredentials() {
    return new Promise((resolve, reject) => {
        if (!webServerProcess) {
            reject(new Error('Web Server läuft nicht'));
            return;
        }
        
        const credentialsListener = (message) => {
            if (message.type === 'credentials') {
                webServerProcess.removeListener('message', credentialsListener);
                currentCredentials = message.data;
                resolve(message.data);
            }
        };
        
        webServerProcess.on('message', credentialsListener);
        webServerProcess.send({ type: 'generateCredentials' });
        
        setTimeout(() => {
            webServerProcess.removeListener('message', credentialsListener);
            reject(new Error('Timeout beim Generieren der Credentials'));
        }, 5000);
    });
}

// Lade gespeicherte Credentials beim Start
function loadStoredCredentials() {
    try {
        const credentialsPath = path.join(__dirname, 'credentials.json');
        if (fs.existsSync(credentialsPath)) {
            const stored = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
            if (stored.expiresAt > Date.now()) {
                return stored;
            }
        }
    } catch (error) {
        console.error('[VRChatControl] Fehler beim Laden gespeicherter Credentials:', error);
    }
    return null;
}

// Lade Instanzen-Status
function getInstancesStatus() {
    try {
        const instancesPath = path.join(__dirname, 'instances_config.json');
        if (fs.existsSync(instancesPath)) {
            return JSON.parse(fs.readFileSync(instancesPath, 'utf8'));
        }
    } catch (error) {
        console.error('[VRChatControl] Fehler beim Laden der Instanzen:', error);
    }
    return {};
}

// Multi-Bot Chatbox-Nachricht senden
async function sendMultiBotChatbox(botIds, message, immediate = true) {
    const results = [];
    
    for (const botId of botIds) {
        try {
            const response = await fetch(`http://localhost:${config.port}/api/osc/chatbox/send`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    botId, 
                    message: message.substring(0, 144),
                    immediate, 
                    notification: false 
                })
            });
            
            if (response.ok) {
                results.push({ botId, success: true });
            } else {
                const error = await response.json();
                results.push({ botId, success: false, error: error.error });
            }
        } catch (error) {
            results.push({ botId, success: false, error: error.message });
        }
        
        // Kurze Verzögerung zwischen den Bots um Rate-Limiting zu vermeiden
        await new Promise(resolve => setTimeout(resolve, 200));
    }
    
    return results;
}

// Multi-Bot OSC Chatbox über neue API
async function sendMultiBotOSCChatbox(botIds, message, immediate = true) {
    try {
        const response = await fetch(`http://localhost:${config.port}/api/osc/chatbox/send/multi`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                botIds, 
                message: message.substring(0, 144),
                immediate, 
                notification: false 
            })
        });
        
        if (response.ok) {
            const data = await response.json();
            return data.results || botIds.map(botId => ({ botId, success: true }));
        } else {
            const error = await response.json();
            throw new Error(error.error || 'Unbekannter Fehler');
        }
    } catch (error) {
        // Fallback auf einzelne Requests
        return await sendMultiBotChatbox(botIds, message, immediate);
    }
}

// Auto-Start beim Modul-Load
let isInitialized = false;

function autoStartSystem(client) {
    if (isInitialized) return;
    isInitialized = true;
    
    console.log('[VRChatControl] 🚀 Initialisiere VRChat Control System...');
    
    // Lade Config
    config = loadConfig();
    
    // Starte Web Server automatisch
    startWebServer(client);
    
    console.log(`[VRChatControl] ✅ System gestartet - Dashboard: http://localhost:${config.port}`);
    console.log(`[VRChatControl] 📡 Multi-Bot OSC System aktiv`);
    console.log(`[VRChatControl] 📝 Template Editor verfügbar`);
    
    // Graceful Shutdown Handler
    const originalExit = process.exit;
    process.exit = function(code) {
        console.log('[VRChatControl] 🛑 Beende VRChat Control System...');
        if (webServerProcess) {
            webServerProcess.kill();
        }
        originalExit(code);
    };
    
    // Signal Handlers
    process.on('SIGTERM', async () => {
        console.log('[VRChatControl] SIGTERM empfangen, beende Web Server...');
        if (webServerProcess) {
            webServerProcess.kill();
        }
    });
    
    process.on('SIGINT', async () => {
        console.log('[VRChatControl] SIGINT empfangen, beende Web Server...');
        if (webServerProcess) {
            webServerProcess.kill();
        }
    });
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('vrchat')
        .setDescription('VRChat Control System - Verwaltet bis zu 5 VRChat Bots mit Multi-Bot OSC')
        .addSubcommand(subcommand =>
            subcommand
                .setName('dashboard')
                .setDescription('Zeigt den Link zum Web Dashboard an')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('reset')
                .setDescription('Generiert neue Login-Daten für das Dashboard')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('status')
                .setDescription('Zeigt den aktuellen Status aller Bots an')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('chatbox')
                .setDescription('Sende eine OSC Chatbox-Nachricht an einen Bot')
                .addStringOption(option =>
                    option.setName('bot')
                        .setDescription('Bot ID (bot1, bot2, etc.)')
                        .setRequired(true)
                        .addChoices(
                            { name: 'Bot 1', value: 'bot1' },
                            { name: 'Bot 2', value: 'bot2' },
                            { name: 'Bot 3', value: 'bot3' },
                            { name: 'Bot 4', value: 'bot4' },
                            { name: 'Bot 5', value: 'bot5' }
                        ))
                .addStringOption(option =>
                    option.setName('message')
                        .setDescription('Nachricht für die Chatbox (max 144 Zeichen)')
                        .setRequired(true))
                .addBooleanOption(option =>
                    option.setName('immediate')
                        .setDescription('Sofort senden (default: true)')
                        .setRequired(false))
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('multi-chatbox')
                .setDescription('Sende Chatbox-Nachricht an mehrere ausgewählte Bots')
                .addStringOption(option =>
                    option.setName('message')
                        .setDescription('Nachricht für die Chatbox (max 144 Zeichen)')
                        .setRequired(true))
                .addBooleanOption(option =>
                    option.setName('immediate')
                        .setDescription('Sofort senden (default: true)')
                        .setRequired(false))
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('template')
                .setDescription('Template-Management für OSC Nachrichten')
                .addStringOption(option =>
                    option.setName('action')
                        .setDescription('Template-Aktion')
                        .setRequired(true)
                        .addChoices(
                            { name: 'Liste anzeigen', value: 'list' },
                            { name: 'Template erstellen', value: 'create' },
                            { name: 'Template löschen', value: 'delete' }
                        ))
                .addStringOption(option =>
                    option.setName('name')
                        .setDescription('Template Name (für create/delete)')
                        .setRequired(false))
                .addStringOption(option =>
                    option.setName('content')
                        .setDescription('Template Inhalt (für create)')
                        .setRequired(false))
                .addStringOption(option =>
                    option.setName('description')
                        .setDescription('Template Beschreibung (für create)')
                        .setRequired(false))
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('loop')
                .setDescription('Starte/stoppe OSC Loop für Bot(s)')
                .addStringOption(option =>
                    option.setName('action')
                        .setDescription('Loop-Aktion')
                        .setRequired(true)
                        .addChoices(
                            { name: 'Single Bot Loop starten', value: 'start_single' },
                            { name: 'Multi-Bot Loop starten', value: 'start_multi' },
                            { name: 'Loop stoppen', value: 'stop' },
                            { name: 'Alle Loops stoppen', value: 'stop_all' }
                        ))
                .addStringOption(option =>
                    option.setName('bot')
                        .setDescription('Bot ID (für single loop)')
                        .setRequired(false)
                        .addChoices(
                            { name: 'Bot 1', value: 'bot1' },
                            { name: 'Bot 2', value: 'bot2' },
                            { name: 'Bot 3', value: 'bot3' },
                            { name: 'Bot 4', value: 'bot4' },
                            { name: 'Bot 5', value: 'bot5' }
                        ))
                .addStringOption(option =>
                    option.setName('template')
                        .setDescription('Template Name')
                        .setRequired(false))
                .addIntegerOption(option =>
                    option.setName('interval')
                        .setDescription('Intervall in Sekunden (2-60)')
                        .setMinValue(2)
                        .setMaxValue(60)
                        .setRequired(false))
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('osc-status')
                .setDescription('Zeigt den Multi-Bot OSC-System Status an')
        ),

    // Auto-Start Funktion für einfache Integration
    init(client) {
        autoStartSystem(client);
    },

    async execute(interaction, client) {
        // Stelle sicher, dass das System initialisiert ist
        autoStartSystem(client);
        // Lade Config beim ersten Aufruf
        if (!config) {
            config = loadConfig();
        }
        
        // Starte Web Server beim ersten Aufruf
        if (!webServerProcess) {
            startWebServer(client);
            // Warte kurz bis Server startet
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
        
        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'dashboard') {
            const serverUrl = config.host === '0.0.0.0' 
                ? `http://localhost:${config.port}` 
                : `http://${config.host}:${config.port}`;
            
            const embed = new EmbedBuilder()
                .setColor(0x8A2BE2)
                .setTitle('🎮 VRChat Control Dashboard v2.0')
                .setDescription(`Erweiterte VRChat Multi-Bot Steuerung mit OSC und Template-Editor.`)
                .addFields(
                    { 
                        name: '🔗 Dashboard URL', 
                        value: `\`\`\`${DASHBOARD_URL}\`\`\``, 
                        inline: false 
                    },
                    {
                        name: '📋 Neue Features',
                        value: `• 👥 Multi-Bot OSC Steuerung\n• 📝 Template Editor für Nachrichten\n• 🔄 Multi-Bot Loops\n• 📊 Erweiterte Monitoring\n• 💬 Chatbox für mehrere Bots gleichzeitig`,
                        inline: false
                    },
                    {
                        name: '📡 OSC System',
                        value: `• Verschiedene Ports pro Bot\n• Rate-Limited & VRChat-kompatibel\n• Custom Template Support\n• Single & Multi-Bot Loops`,
                        inline: false
                    },
                    {
                        name: '🔐 Hinweise',
                        value: '• Die Login-Daten findest du unten\n• Credentials sind 24 Stunden gültig\n• Nutze `/vrchat reset` für neue Credentials',
                        inline: false
                    }
                )
                .setTimestamp()
                .setFooter({ text: 'VRChat Multi-Instance Control System v2.1 - Extended' });

            // Lade aktuelle Credentials
            const credentialsPath = path.join(__dirname, 'credentials.json');
            let credentialsEmbed = null;
            
            try {
                if (fs.existsSync(credentialsPath)) {
                    const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
                    
                    if (credentials.expiresAt > Date.now()) {
                        const expiresIn = Math.floor((credentials.expiresAt - Date.now()) / 1000 / 60 / 60);
                        
                        credentialsEmbed = new EmbedBuilder()
                            .setColor(0x28A745)
                            .setTitle('🔐 Aktuelle Login-Daten')
                            .setDescription('**⚠️ Diese Nachricht enthält sensible Daten!**')
                            .addFields(
                                { name: 'Username', value: `\`\`\`${credentials.username}\`\`\``, inline: true },
                                { name: 'Gültig noch', value: `${expiresIn} Stunden`, inline: true }
                            )
                            .setFooter({ text: '⚠️ Das Passwort wird nur beim Generieren angezeigt!' });
                    } else {
                        credentialsEmbed = new EmbedBuilder()
                            .setColor(0xDC3545)
                            .setTitle('❌ Login-Daten abgelaufen')
                            .setDescription('Verwende `/vrchat reset` um neue Credentials zu generieren.');
                    }
                }
            } catch (error) {
                console.error('[VRChatControl] Fehler beim Lesen der Credentials:', error);
            }

            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(BUTTON_IDS.REFRESH_CREDS)
                        .setLabel('Neue Login-Daten')
                        .setStyle(ButtonStyle.Primary)
                        .setEmoji('🔄'),
                    new ButtonBuilder()
                        .setCustomId(BUTTON_IDS.SHOW_STATUS)
                        .setLabel('Bot Status')
                        .setStyle(ButtonStyle.Secondary)
                        .setEmoji('📊'),
                    new ButtonBuilder()
                        .setCustomId(BUTTON_IDS.OSC_STATUS)
                        .setLabel('OSC Status')
                        .setStyle(ButtonStyle.Secondary)
                        .setEmoji('📡'),
                    new ButtonBuilder()
                        .setCustomId(BUTTON_IDS.MULTI_CHATBOX)
                        .setLabel('Multi-Bot Chatbox')
                        .setStyle(ButtonStyle.Success)
                        .setEmoji('📢')
                );

            const embeds = [embed];
            if (credentialsEmbed) embeds.push(credentialsEmbed);

            await interaction.reply({ 
                embeds: embeds,
                components: [row],
                flags: MessageFlags.Ephemeral 
            });

            // Button Collector
            const message = await interaction.fetchReply();
            const collector = message.createMessageComponentCollector({ 
                componentType: 2,
                time: 300000 // 5 Minuten
            });

            collector.on('collect', async i => {
                if (i.customId === BUTTON_IDS.REFRESH_CREDS) {
                    await i.deferUpdate();
                    
                    try {
                        const newCreds = await generateNewCredentials();
                        
                        const newCredsEmbed = new EmbedBuilder()
                            .setColor(0x28A745)
                            .setTitle('✅ Neue Login-Daten generiert')
                            .setDescription('**⚠️ WICHTIG: Passwort wird nur JETZT angezeigt!**')
                            .addFields(
                                { name: 'Username', value: `\`\`\`${newCreds.username}\`\`\``, inline: false },
                                { name: 'Password', value: `\`\`\`${newCreds.password}\`\`\``, inline: false }
                            )
                            .setFooter({ text: 'Diese Daten sind 24 Stunden gültig' })
                            .setTimestamp();

                        await i.followUp({ 
                            embeds: [newCredsEmbed], 
                            flags: MessageFlags.Ephemeral 
                        });
                    } catch (error) {
                        await i.followUp({ 
                            content: `❌ Fehler: ${error.message}`,
                            flags: MessageFlags.Ephemeral 
                        });
                    }
                } else if (i.customId === BUTTON_IDS.SHOW_STATUS) {
                    await i.deferUpdate();
                    
                    const instances = getInstancesStatus();
                    const statusEmbed = createStatusEmbed(instances);
                    
                    await i.followUp({
                        embeds: [statusEmbed],
                        flags: MessageFlags.Ephemeral
                    });
                } else if (i.customId === BUTTON_IDS.OSC_STATUS) {
                    await i.deferUpdate();
                    
                    try {
                        const response = await fetch(`http://localhost:${config.port}/api/osc/status`);
                        if (response.ok) {
                            const oscStatus = await response.json();
                            const oscEmbed = createOSCStatusEmbed(oscStatus);
                            await i.followUp({
                                embeds: [oscEmbed],
                                flags: MessageFlags.Ephemeral
                            });
                        } else {
                            await i.followUp({
                                content: '❌ OSC-Status konnte nicht abgerufen werden',
                                flags: MessageFlags.Ephemeral
                            });
                        }
                    } catch (error) {
                        await i.followUp({
                            content: `❌ OSC-System nicht verfügbar: ${error.message}`,
                            flags: MessageFlags.Ephemeral
                        });
                    }
                } else if (i.customId === BUTTON_IDS.MULTI_CHATBOX) {
                    await i.deferUpdate();
                    
                    // Zeige Bot-Auswahl für Multi-Chatbox
                    const instances = getInstancesStatus();
                    const runningBots = Object.entries(instances)
                        .filter(([_, instance]) => instance.status === 'running')
                        .map(([botId, instance]) => ({
                            label: instance.name,
                            value: botId,
                            description: `Status: ${instance.status}`,
                            emoji: '🤖'
                        }));
                    
                    if (runningBots.length === 0) {
                        await i.followUp({
                            content: '❌ Keine laufenden Bots gefunden!',
                            flags: MessageFlags.Ephemeral
                        });
                        return;
                    }
                    
                    const selectMenu = new StringSelectMenuBuilder()
                        .setCustomId('vrchat_multi_bot_select')
                        .setPlaceholder('Wähle Bots für Multi-Chatbox...')
                        .setMinValues(1)
                        .setMaxValues(Math.min(runningBots.length, 5))
                        .addOptions(runningBots);
                    
                    const selectRow = new ActionRowBuilder().addComponents(selectMenu);
                    
                    await i.followUp({
                        content: '📢 **Multi-Bot Chatbox Setup**\n\nWähle die Bots aus, an die du eine Nachricht senden möchtest:',
                        components: [selectRow],
                        flags: MessageFlags.Ephemeral
                    });
                }
            });

        } else if (subcommand === 'reset') {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            try {
                const newCreds = await generateNewCredentials();
                
                const serverUrl = config.host === '0.0.0.0' 
                    ? `http://localhost:${config.port}` 
                    : `http://${config.host}:${config.port}`;
                
                const embed = new EmbedBuilder()
                    .setColor(0x28A745)
                    .setTitle('✅ Dashboard Login zurückgesetzt')
                    .setDescription('Neue Login-Daten wurden generiert.')
                    .addFields(
                        { 
                            name: '🔗 Dashboard URL', 
                            value: `\`\`\`${DASHBOARD_URL}\`\`\``, 
                            inline: false 
                        },
                        { 
                            name: '👤 Username', 
                            value: `\`\`\`${newCreds.username}\`\`\``, 
                            inline: false 
                        },
                        { 
                            name: '🔑 Password', 
                            value: `\`\`\`${newCreds.password}\`\`\``, 
                            inline: false 
                        }
                    )
                    .setFooter({ text: '⚠️ Diese Daten sind 24 Stunden gültig. Speichere sie sicher!' })
                    .setTimestamp();

                await interaction.editReply({ embeds: [embed] });
            } catch (error) {
                await interaction.editReply({ 
                    content: `❌ Fehler: ${error.message}` 
                });
            }

        } else if (subcommand === 'status') {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            const instances = getInstancesStatus();
            const statusEmbed = createStatusEmbed(instances);

            await interaction.editReply({ embeds: [statusEmbed] });
            
        } else if (subcommand === 'chatbox') {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            const botId = interaction.options.getString('bot');
            const message = interaction.options.getString('message');
            const immediate = interaction.options.getBoolean('immediate') ?? true;
            const user = interaction.user.username;

            try {
                const response = await fetch(`http://localhost:${config.port}/api/osc/chatbox/send`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        botId, 
                        message: message.substring(0, 144),
                        immediate, 
                        notification: false 
                    })
                });

                if (response.ok) {
                    const embed = new EmbedBuilder()
                        .setColor(0x28A745)
                        .setTitle('📤 OSC Chatbox-Nachricht gesendet')
                        .addFields(
                            { name: 'Bot', value: botId, inline: true },
                            { name: 'Nachricht', value: `\`${message.substring(0, 100)}${message.length > 100 ? '...' : ''}\``, inline: false },
                            { name: 'Sofort gesendet', value: immediate ? 'Ja' : 'Nein', inline: true }
                        )
                        .setTimestamp();

                    await interaction.editReply({ embeds: [embed] });
                } else {
                    const error = await response.json();
                    await interaction.editReply({ 
                        content: `❌ Fehler: ${error.error || 'Unbekannter Fehler'}` 
                    });
                }
            } catch (error) {
                await interaction.editReply({ 
                    content: `❌ Verbindungsfehler: ${error.message}` 
                });
            }

        } else if (subcommand === 'multi-chatbox') {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            const message = interaction.options.getString('message');
            const immediate = interaction.options.getBoolean('immediate') ?? true;

            // Zeige Bot-Auswahl
            const instances = getInstancesStatus();
            const runningBots = Object.entries(instances)
                .filter(([_, instance]) => instance.status === 'running')
                .map(([botId, instance]) => ({
                    label: instance.name,
                    value: botId,
                    description: `Status: ${instance.status}`,
                    emoji: '🤖'
                }));
            
            if (runningBots.length === 0) {
                await interaction.editReply({
                    content: '❌ Keine laufenden Bots gefunden!'
                });
                return;
            }
            
            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId('vrchat_multi_chatbox_execute')
                .setPlaceholder('Wähle Bots für die Nachricht...')
                .setMinValues(1)
                .setMaxValues(Math.min(runningBots.length, 5))
                .addOptions(runningBots);
            
            const selectRow = new ActionRowBuilder().addComponents(selectMenu);
            
            const embed = new EmbedBuilder()
                .setColor(0x8A2BE2)
                .setTitle('📢 Multi-Bot Chatbox')
                .addFields(
                    { name: 'Nachricht', value: `\`${message}\``, inline: false },
                    { name: 'Sofort senden', value: immediate ? 'Ja' : 'Nein', inline: true },
                    { name: 'Verfügbare Bots', value: `${runningBots.length}`, inline: true }
                )
                .setDescription('Wähle die Bots aus, an die die Nachricht gesendet werden soll:');
            
            await interaction.editReply({
                embeds: [embed],
                components: [selectRow]
            });

        } else if (subcommand === 'template') {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            const action = interaction.options.getString('action');
            const name = interaction.options.getString('name');
            const content = interaction.options.getString('content');
            const description = interaction.options.getString('description') || '';

            try {
                if (action === 'list') {
                    const response = await fetch(`http://localhost:${config.port}/api/osc/templates`);
                    if (response.ok) {
                        const templates = await response.json();
                        const embed = createTemplateListEmbed(templates);
                        await interaction.editReply({ embeds: [embed] });
                    } else {
                        await interaction.editReply({ content: '❌ Templates konnten nicht geladen werden' });
                    }
                } else if (action === 'create') {
                    if (!name || !content) {
                        await interaction.editReply({ content: '❌ Name und Content sind erforderlich für create' });
                        return;
                    }

                    const response = await fetch(`http://localhost:${config.port}/api/osc/templates/custom`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ name, content, description })
                    });

                    if (response.ok) {
                        const embed = new EmbedBuilder()
                            .setColor(0x28A745)
                            .setTitle('✅ Template erstellt')
                            .addFields(
                                { name: 'Name', value: name, inline: true },
                                { name: 'Content', value: content.substring(0, 100), inline: false }
                            );
                        await interaction.editReply({ embeds: [embed] });
                    } else {
                        const error = await response.json();
                        await interaction.editReply({ content: `❌ Fehler: ${error.error}` });
                    }
                } else if (action === 'delete') {
                    if (!name) {
                        await interaction.editReply({ content: '❌ Template Name ist erforderlich für delete' });
                        return;
                    }

                    const response = await fetch(`http://localhost:${config.port}/api/osc/templates/custom/${encodeURIComponent(name)}`, {
                        method: 'DELETE'
                    });

                    if (response.ok) {
                        await interaction.editReply({ content: `✅ Template "${name}" wurde gelöscht` });
                    } else {
                        const error = await response.json();
                        await interaction.editReply({ content: `❌ Fehler: ${error.error}` });
                    }
                }
            } catch (error) {
                await interaction.editReply({ content: `❌ Verbindungsfehler: ${error.message}` });
            }

        } else if (subcommand === 'loop') {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            const action = interaction.options.getString('action');
            const botId = interaction.options.getString('bot');
            const template = interaction.options.getString('template');
            const interval = (interaction.options.getInteger('interval') || 5) * 1000;

            try {
                if (action === 'start_single') {
                    if (!botId || !template) {
                        await interaction.editReply({ content: '❌ Bot ID und Template sind für Single Loop erforderlich' });
                        return;
                    }

                    const response = await fetch(`http://localhost:${config.port}/api/osc/chatbox/loop/start`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ botId, template, interval })
                    });

                    if (response.ok) {
                        await interaction.editReply({ content: `✅ Single Bot Loop gestartet: ${template} für ${botId} (${interval/1000}s)` });
                    } else {
                        const error = await response.json();
                        await interaction.editReply({ content: `❌ Fehler: ${error.error}` });
                    }
                } else if (action === 'start_multi') {
                    if (!template) {
                        await interaction.editReply({ content: '❌ Template ist für Multi Loop erforderlich' });
                        return;
                    }

                    // Zeige Bot-Auswahl für Multi-Loop
                    const instances = getInstancesStatus();
                    const runningBots = Object.entries(instances)
                        .filter(([_, instance]) => instance.status === 'running')
                        .map(([botId, instance]) => ({
                            label: instance.name,
                            value: botId,
                            description: `Status: ${instance.status}`,
                            emoji: '🔄'
                        }));
                    
                    if (runningBots.length === 0) {
                        await interaction.editReply({ content: '❌ Keine laufenden Bots gefunden!' });
                        return;
                    }
                    
                    const selectMenu = new StringSelectMenuBuilder()
                        .setCustomId(`vrchat_multi_loop_${template}_${interval}`)
                        .setPlaceholder('Wähle Bots für Multi-Loop...')
                        .setMinValues(1)
                        .setMaxValues(Math.min(runningBots.length, 5))
                        .addOptions(runningBots);
                    
                    const selectRow = new ActionRowBuilder().addComponents(selectMenu);
                    
                    await interaction.editReply({
                        content: `🔄 **Multi-Bot Loop Setup**\nTemplate: ${template}\nWähle Bots aus:`,
                        components: [selectRow]
                    });
                } else if (action === 'stop') {
                    if (!botId) {
                        await interaction.editReply({ content: '❌ Bot ID ist zum Stoppen erforderlich' });
                        return;
                    }

                    const response = await fetch(`http://localhost:${config.port}/api/osc/chatbox/loop/stop`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ botId })
                    });

                    if (response.ok) {
                        await interaction.editReply({ content: `✅ Loop für ${botId} gestoppt` });
                    } else {
                        const error = await response.json();
                        await interaction.editReply({ content: `❌ Fehler: ${error.error}` });
                    }
                } else if (action === 'stop_all') {
                    // Hier könntest du eine API hinzufügen um alle Loops zu stoppen
                    await interaction.editReply({ content: '⚠️ Stop All Loops ist noch nicht implementiert - nutze das Dashboard' });
                }
            } catch (error) {
                await interaction.editReply({ content: `❌ Verbindungsfehler: ${error.message}` });
            }

        } else if (subcommand === 'osc-status') {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            try {
                const response = await fetch(`http://localhost:${config.port}/api/osc/status`);

                if (response.ok) {
                    const oscStatus = await response.json();
                    const embed = createOSCStatusEmbed(oscStatus);
                    await interaction.editReply({ embeds: [embed] });
                } else {
                    await interaction.editReply({ 
                        content: `❌ Fehler beim Abrufen des OSC-Status` 
                    });
                }
            } catch (error) {
                await interaction.editReply({ 
                    content: `❌ OSC-System nicht verfügbar: ${error.message}` 
                });
            }
        }
    }
};

function createStatusEmbed(instances) {
    const embed = new EmbedBuilder()
        .setColor(0x8A2BE2)
        .setTitle('📊 VRChat Bots Status')
        .setTimestamp();

    if (!instances || Object.keys(instances).length === 0) {
        embed.setDescription('Keine Bot-Instanzen gefunden.');
        return embed;
    }

    let runningCount = 0;
    let stoppedCount = 0;
    let errorCount = 0;
    let totalRam = 0;

    const fields = [];
    
    for (const [botId, instance] of Object.entries(instances)) {
        let statusEmoji = '';
        
        switch (instance.status) {
            case 'running':
                statusEmoji = '🟢';
                runningCount++;
                break;
            case 'starting':
            case 'waiting_pid':
                statusEmoji = '🟡';
                break;
            case 'stopped':
                statusEmoji = '🔴';
                stoppedCount++;
                break;
            case 'error':
                statusEmoji = '💥';
                errorCount++;
                break;
            default:
                statusEmoji = '❓';
        }

        let fieldValue = `${statusEmoji} **Status:** ${getStatusText(instance.status)}`;
        
        if (instance.pid) {
            fieldValue += `\n🆔 **PID:** ${instance.pid}`;
        }
        
        if (instance.ram && instance.ram !== 'N/A') {
            fieldValue += `\n🧠 **RAM:** ${instance.ram}`;
            // Versuche RAM zu parsen für Gesamt-Berechnung
            const ramMatch = instance.ram.match(/(\d+\.?\d*)\s*(GB|MB)/);
            if (ramMatch) {
                const value = parseFloat(ramMatch[1]);
                const unit = ramMatch[2];
                totalRam += unit === 'GB' ? value : value / 1024;
            }
        }
        
        if (instance.uptime && instance.uptime > 0) {
            fieldValue += `\n⏱️ **Uptime:** ${formatUptime(instance.uptime)}`;
        }
        
        if (instance.worldId) {
            const shortWorldId = instance.worldId.length > 30 
                ? instance.worldId.substring(0, 30) + '...' 
                : instance.worldId;
            fieldValue += `\n🌍 **World:** ${shortWorldId}`;
        }

        fields.push({
            name: `${instance.name}`,
            value: fieldValue,
            inline: true
        });
    }

    // Übersichts-Field
    const totalBots = Object.keys(instances).length;
    const overviewValue = `**Gesamt:** ${totalBots} Bots
🟢 Aktiv: ${runningCount}
🔴 Gestoppt: ${stoppedCount}
💥 Fehler: ${errorCount}
🧠 Gesamt RAM: ${totalRam.toFixed(2)} GB`;

    embed.addFields(
        { name: '📈 Übersicht', value: overviewValue, inline: false },
        ...fields
    );

    return embed;
}

function createOSCStatusEmbed(oscStatus) {
    const embed = new EmbedBuilder()
        .setColor(oscStatus.connected ? 0x28A745 : 0xDC3545)
        .setTitle('📡 Multi-Bot OSC-System Status')
        .setTimestamp();

    if (!oscStatus.connected) {
        embed.setDescription('❌ OSC-System ist nicht verfügbar oder nicht verbunden');
        return embed;
    }

    const connectionInfo = `🟢 **Multi-Bot OSC Aktiv**
📤 Bot-Ports: ${Object.keys(oscStatus.botPorts || {}).length}
🌐 Host: ${oscStatus.config.host || '127.0.0.1'}`;

    const queueInfo = `📊 **Queue-Status**
💬 Chatbox: ${oscStatus.chatboxQueue} wartend`;

    const loopInfo = `🔄 **Aktive Loops**
💬 Chat-Loops: ${oscStatus.activeChatLoops}`;

    embed.addFields(
        { name: '🔗 Verbindung', value: connectionInfo, inline: false },
        { name: '📋 Warteschlangen', value: queueInfo, inline: true },
        { name: '⚡ Loops', value: loopInfo, inline: true }
    );

    if (oscStatus.botPorts) {
        const portList = Object.entries(oscStatus.botPorts)
            .map(([botId, port]) => `• ${botId}: Port ${port}`)
            .join('\n');
        embed.addFields({
            name: '🔌 Bot-Ports',
            value: portList || 'Keine konfiguriert',
            inline: true
        });
    }

    if (oscStatus.chatLoops && oscStatus.chatLoops.length > 0) {
        embed.addFields({
            name: '💬 Aktive Chat-Loops',
            value: oscStatus.chatLoops.map(loopId => `• ${loopId}`).join('\n') || 'Keine',
            inline: true
        });
    }

    if (oscStatus.totalCustomTemplates > 0) {
        embed.addFields({
            name: '📝 Custom Templates',
            value: `${oscStatus.totalCustomTemplates} Templates verfügbar`,
            inline: true
        });
    }

    embed.setFooter({ text: '💡 Nutze das Web-Dashboard für erweiterte OSC-Kontrolle mit Template-Editor' });

    return embed;
}

function createTemplateListEmbed(templates) {
    const embed = new EmbedBuilder()
        .setColor(0x8A2BE2)
        .setTitle('📝 Verfügbare Templates')
        .setTimestamp();

    if (templates.builtin && templates.builtin.length > 0) {
        const builtinList = templates.builtin.join(', ');
        embed.addFields({
            name: '📋 Built-in Templates',
            value: builtinList,
            inline: false
        });
    }

    if (templates.custom && templates.custom.length > 0) {
        const customList = templates.custom.map(t => `• ${t.name}: \`${t.content.substring(0, 50)}${t.content.length > 50 ? '...' : ''}\``).join('\n');
        embed.addFields({
            name: '✏️ Custom Templates',
            value: customList,
            inline: false
        });
    } else {
        embed.addFields({
            name: '✏️ Custom Templates',
            value: 'Keine Custom Templates gefunden',
            inline: false
        });
    }

    embed.setFooter({ text: 'Nutze den Template Editor im Dashboard für erweiterte Verwaltung' });

    return embed;
}

function getStatusText(status) {
    switch (status) {
        case 'running': return 'Läuft';
        case 'starting': return 'Startet...';
        case 'waiting_pid': return 'Warte auf VRChat.exe...';
        case 'stopped': return 'Gestoppt';
        case 'error': return 'Fehler';
        default: return 'Unbekannt';
    }
}

function formatUptime(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
        return `${days}d ${hours % 24}h`;
    } else if (hours > 0) {
        return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
        return `${minutes}m`;
    } else {
        return `${seconds}s`;
    }
}