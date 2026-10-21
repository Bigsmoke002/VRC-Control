// addons/vrc-control/setup.js
// Automatisches Setup-Script für das VRChat Control System

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

console.log('🚀 VRChat Control System Setup');
console.log('=====================================\n');

// Überprüfe ob alle erforderlichen Dateien vorhanden sind
const requiredFiles = [
    'web_server.js',
    'cmd_vrchatcontrol.js',
    'public/index.html'
];

console.log('📋 Überprüfe erforderliche Dateien...');
let missingFiles = [];

requiredFiles.forEach(file => {
    const filePath = path.join(__dirname, file);
    if (fs.existsSync(filePath)) {
        console.log(`✅ ${file}`);
    } else {
        console.log(`❌ ${file} FEHLT!`);
        missingFiles.push(file);
    }
});

if (missingFiles.length > 0) {
    console.error('\n❌ Setup abgebrochen. Fehlende Dateien:');
    missingFiles.forEach(file => console.error(`   - ${file}`));
    process.exit(1);
}

// Erstelle public Ordner falls nicht vorhanden
const publicDir = path.join(__dirname, 'public');
if (!fs.existsSync(publicDir)) {
    console.log('\n📁 Erstelle public/ Ordner...');
    fs.mkdirSync(publicDir, { recursive: true });
    console.log('✅ public/ Ordner erstellt');
}

// Kopiere index.html in public Ordner falls nicht vorhanden
const indexSrc = path.join(__dirname, 'index.html');
const indexDest = path.join(publicDir, 'index.html');

if (fs.existsSync(indexSrc) && !fs.existsSync(indexDest)) {
    console.log('📄 Kopiere index.html zu public/...');
    fs.copyFileSync(indexSrc, indexDest);
    console.log('✅ index.html kopiert');
}

// Erstelle Standard-Konfigurationsdateien
console.log('\n⚙️ Erstelle Konfigurationsdateien...');

// web_config.json
const webConfigPath = path.join(__dirname, 'web_config.json');
if (!fs.existsSync(webConfigPath)) {
    const defaultWebConfig = {
        "host": "127.0.0.1",
        "port": 4545,
        "discordChannelId": "",
        "adminRoleId": "",
        "maxBots": 5,
        "launchExePaths": {
            "bot1": "C:\\Program Files (x86)\\Steam\\steamapps\\common\\VRChat\\launch.exe",
            "bot2": "C:\\Program Files (x86)\\Steam\\steamapps\\common\\VRChat\\launch.exe",
            "bot3": "C:\\Program Files (x86)\\Steam\\steamapps\\common\\VRChat\\launch.exe",
            "bot4": "C:\\Program Files (x86)\\Steam\\steamapps\\common\\VRChat\\launch.exe",
            "bot5": "C:\\Program Files (x86)\\Steam\\steamapps\\common\\VRChat\\launch.exe"
        },
        "startupDelay": 15000,
        "worldPresets": {
            "Hub": "wrld_8b9b2990-7313-4430-9294-5e482036b483",
            "Hangout Spot": "wrld_4cf554b4-430c-4f8f-b53e-1f294eed230b",
            "Club Scene": "wrld_5b89c79e-c340-4510-be1b-476e9fcdfd84",
            "Game World": "wrld_6d0e89a6-d451-4c1f-a89c-5e7f1045b9c8",
            "Meeting Room": "wrld_7c1f9ab7-e562-4d2g-b9ad-6f8g2156ca9d"
        },
        "osc": {
            "enabled": true,
            "inPort": 9001,
            "outPort": 9000,
            "host": "127.0.0.1",
            "rateLimit": {
                "chatbox": 1500,
                "parameters": 50
            }
        }
    };
    
    fs.writeFileSync(webConfigPath, JSON.stringify(defaultWebConfig, null, 2));
    console.log('✅ web_config.json erstellt');
} else {
    console.log('ℹ️  web_config.json bereits vorhanden');
}

// instances_config.json
const instancesConfigPath = path.join(__dirname, 'instances_config.json');
if (!fs.existsSync(instancesConfigPath)) {
    const defaultInstancesConfig = {};
    
    for (let i = 1; i <= 5; i++) {
        defaultInstancesConfig[`bot${i}`] = {
            "name": `VRChat Bot ${i}`,
            "worldId": "",
            "pid": null,
            "startTime": null,
            "status": "stopped",
            "ram": "N/A",
            "cpu": "N/A",
            "uptime": 0
        };
    }
    
    fs.writeFileSync(instancesConfigPath, JSON.stringify(defaultInstancesConfig, null, 2));
    console.log('✅ instances_config.json erstellt');
} else {
    console.log('ℹ️  instances_config.json bereits vorhanden');
}

// vrc_control_config.json (falls nicht vorhanden)
const vrcConfigPath = path.join(__dirname, 'vrc_control_config.json');
if (!fs.existsSync(vrcConfigPath)) {
    const defaultVrcConfig = {
        "debugLogChannelId": "",
        "adminRoleId": ""
    };
    
    fs.writeFileSync(vrcConfigPath, JSON.stringify(defaultVrcConfig, null, 2));
    console.log('✅ vrc_control_config.json erstellt');
} else {
    console.log('ℹ️  vrc_control_config.json bereits vorhanden');
}

// Überprüfe VRChat Installation
console.log('\n🎮 Überprüfe VRChat Installation...');

const commonVRChatPaths = [
    "C:\\Program Files (x86)\\Steam\\steamapps\\common\\VRChat\\launch.exe",
    "C:\\Program Files\\Steam\\steamapps\\common\\VRChat\\launch.exe",
    "D:\\Steam\\steamapps\\common\\VRChat\\launch.exe",
    "E:\\Steam\\steamapps\\common\\VRChat\\launch.exe"
];

let vrchatFound = false;
let vrchatPath = null;

for (const testPath of commonVRChatPaths) {
    if (fs.existsSync(testPath)) {
        vrchatFound = true;
        vrchatPath = testPath;
        console.log(`✅ VRChat gefunden: ${testPath}`);
        break;
    }
}

if (!vrchatFound) {
    console.log('⚠️  VRChat launch.exe nicht an Standard-Pfaden gefunden.');
    console.log('💡 Bitte aktualisiere die Pfade in web_config.json manuell.');
} else {
    // Aktualisiere Pfade in web_config.json
    try {
        const webConfig = JSON.parse(fs.readFileSync(webConfigPath, 'utf8'));
        let updated = false;
        
        for (let i = 1; i <= 5; i++) {
            const botId = `bot${i}`;
            if (webConfig.launchExePaths[botId] !== vrchatPath) {
                webConfig.launchExePaths[botId] = vrchatPath;
                updated = true;
            }
        }
        
        if (updated) {
            fs.writeFileSync(webConfigPath, JSON.stringify(webConfig, null, 2));
            console.log('✅ VRChat-Pfade in web_config.json aktualisiert');
        }
    } catch (error) {
        console.error('❌ Fehler beim Aktualisieren der VRChat-Pfade:', error.message);
    }
}

// Überprüfe Node.js Dependencies
console.log('\n📦 Überprüfe Node.js Dependencies...');

const requiredPackages = ['express', 'express-session', 'bcrypt', 'ws'];
const packageJsonPath = path.join(__dirname, '..', '..', 'package.json');

if (fs.existsSync(packageJsonPath)) {
    try {
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
        const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };
        
        const missingPackages = requiredPackages.filter(pkg => !dependencies[pkg]);
        
        if (missingPackages.length > 0) {
            console.log('⚠️  Fehlende Node.js Pakete:');
            missingPackages.forEach(pkg => console.log(`   - ${pkg}`));
            console.log('\n💡 Installiere mit: npm install ' + missingPackages.join(' '));
        } else {
            console.log('✅ Alle erforderlichen Node.js Pakete sind verfügbar');
        }
    } catch (error) {
        console.log('⚠️  Konnte package.json nicht lesen');
    }
} else {
    console.log('⚠️  package.json nicht gefunden');
    console.log('💡 Stelle sicher, dass alle Dependencies installiert sind:');
    console.log('   npm install express express-session bcrypt ws');
}

// Erstelle Hilfs-Scripts
console.log('\n📜 Erstelle Hilfs-Scripts...');

// cleanup.bat für Windows  
const cleanupBatContent = `@echo off
echo VRChat Control System - Port Cleanup
echo ====================================
echo.
node cleanup_port.js
echo.
pause`;

fs.writeFileSync(path.join(__dirname, 'cleanup.bat'), cleanupBatContent);
console.log('✅ cleanup.bat erstellt');

// integration-example.js für Referenz
const integrationExample = `// Beispiel-Integration in deinen Discord-Bot
const { Client, GatewayIntentBits, Collection } = require('discord.js');

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
client.commands = new Collection();

// VRChat Control System laden
const vrchatControl = require('./addons/vrc-control/cmd_vrchatcontrol.js');
client.commands.set(vrchatControl.data.name, vrchatControl);

client.once('ready', () => {
    console.log(\`🤖 Bot ist online als \${client.user.tag}\`);
    
    // VRChat System automatisch starten
    vrchatControl.init(client);
});

// Command Handler
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const command = client.commands.get(interaction.commandName);
    if (!command) return;

    try {
        await command.execute(interaction, client);
    } catch (error) {
        console.error(error);
        await interaction.reply({ content: 'Fehler!', ephemeral: true });
    }
});

client.login('DEIN_BOT_TOKEN');
`;

fs.writeFileSync(path.join(__dirname, 'integration-example.js'), integrationExample);
console.log('✅ integration-example.js erstellt');

// Erstelle README.md
const readmeContent = `# VRChat Control System

Ein erweiterbares Discord-Bot-System zur Verwaltung von bis zu 5 VRChat-Bot-Instanzen.

## 🚀 Automatischer Start

Das System startet **automatisch** mit deinem Discord-Bot - keine separaten Batch-Dateien mehr nötig!

## Features

- 🎮 Bis zu 5 gleichzeitige VRChat-Bot-Instanzen
- 🌐 Web-Dashboard mit Live-Updates
- 🔧 World-Presets für einfache Auswahl
- 📊 Ressourcen-Monitoring (RAM, CPU, Uptime)
- 🔐 Sichere Authentifizierung mit 24h-Tokens
- 💬 Discord-Integration mit Logging
- ⚡ **Automatischer Start beim Bot-Start**

## Installation

1. Stelle sicher, dass Node.js installiert ist
2. Installiere Dependencies: \`npm install express express-session bcrypt ws\`
3. Führe das Setup aus: \`node setup.js\`
4. Integriere in deinen Discord-Bot (siehe unten)

## Discord-Bot Integration

### Einfache Integration:

\`\`\`javascript
const vrchatControl = require('./addons/vrc-control/cmd_vrchatcontrol.js');
client.commands.set(vrchatControl.data.name, vrchatControl);

client.once('ready', () => {
    console.log('Bot ist bereit!');
    vrchatControl.init(client); // ✅ Auto-Start
});
\`\`\`

### Vollständiges Beispiel:

Siehe \`integration-example.js\` für eine komplette Bot-Integration.

## Konfiguration

### Discord-Channels
\`\`\`json
// vrc_control_config.json
{
  "debugLogChannelId": "YOUR_CHANNEL_ID",
  "adminRoleId": "YOUR_ROLE_ID"
}
\`\`\`

### VRChat-Pfade
\`\`\`json
// web_config.json
{
  "launchExePaths": {
    "bot1": "C:\\\\...\\\\VRChat\\\\launch.exe",
    ...
  }
}
\`\`\`

## Verwendung

### Bot starten:
\`\`\`bash
node index.js  # Dein Discord-Bot (VRChat System startet automatisch)
\`\`\`

### Discord-Befehle:
- \`/vrchat dashboard\` - Web-Dashboard Link und Login-Daten
- \`/vrchat status\` - Aktueller Status aller Bots
- \`/vrchat reset\` - Generiert neue Login-Daten

### Web-Dashboard:
- URL: http://localhost:4545
- Login-Daten via \`/vrchat dashboard\`

## Fehlerbehebung

### Port bereits belegt:
\`\`\`bash
node cleanup_port.js
# oder
cleanup.bat
\`\`\`

### Setup erneut ausführen:
\`\`\`bash
node setup.js
\`\`\`

### VRChat-Pfade prüfen:
Bearbeite \`launchExePaths\` in \`web_config.json\`

## Backup & Restore

\`\`\`bash
node backup.js create          # Backup erstellen
node backup.js list            # Backups anzeigen
node backup.js restore <name>  # Backup wiederherstellen
\`\`\`

## Sicherheit

- Login-Daten sind 24 Stunden gültig
- Passwörter werden gehashed gespeichert
- Web-Dashboard standardmäßig nur lokal erreichbar
- Ephemere Discord-Nachrichten für sensible Daten

## Automatische Features

- ✅ Web-Server startet mit dem Discord-Bot
- ✅ Automatische PID-Zuordnung für VRChat-Prozesse
- ✅ Live-Updates im Dashboard
- ✅ Automatisches Backup-System verfügbar
- ✅ Graceful Shutdown beim Bot-Stop

## Support

Bei Problemen:
1. Prüfe Console-Logs beim Bot-Start
2. Teste mit \`/vrchat dashboard\`
3. Führe \`node setup.js\` erneut aus
4. Prüfe VRChat-Installation und -Pfade
5. Siehe INTEGRATION.md für detaillierte Anleitung
`;

fs.writeFileSync(path.join(__dirname, 'README.md'), readmeContent);
console.log('✅ README.md erstellt');

// Abschluss
console.log('\n🎉 Setup abgeschlossen!');
console.log('=====================================');
console.log('📖 Nächste Schritte:');
console.log('1. Konfiguriere Discord-Channels in vrc_control_config.json');
console.log('2. Überprüfe VRChat-Pfade in web_config.json');
console.log('3. Integriere in deinen Discord-Bot:');
console.log('   - Siehe integration-example.js für Code-Beispiel');
console.log('   - Oder INTEGRATION.md für detaillierte Anleitung');
console.log('4. Starte deinen Discord-Bot normal');
console.log('5. Dashboard öffnet automatisch: http://localhost:4545');
console.log('6. OSC-Features sind sofort verfügbar im Dashboard');
console.log('\n🎯 OSC-Features:');
console.log('   📤 Chatbox-Nachrichten senden (Einzeln & Loops)');
console.log('   🎭 Avatar-Parameter steuern (Einzeln & Loops)');
console.log('   📊 Live-OSC-Monitoring im Dashboard');
console.log('   🔄 Rate-Limited & VRChat-kompatibel');
console.log('\n💡 Verwende cleanup.bat wenn Port-Probleme auftreten');
console.log('📚 Weitere Infos in README.md und INTEGRATION.md');
console.log('\n⚡ Das System startet jetzt AUTOMATISCH mit deinem Bot!');
console.log('   Keine start.bat mehr nötig - einfach Bot starten!');

// Überprüfe verfügbaren Port
console.log('\n🔍 Überprüfe Port-Verfügbarkeit...');
exec('netstat -ano | findstr :4545', (error, stdout) => {
    if (stdout && stdout.trim()) {
        console.log('⚠️  Port 4545 wird bereits verwendet!');
        console.log('💡 Führe cleanup.bat aus oder ändere den Port in web_config.json');
    } else {
        console.log('✅ Port 4545 ist verfügbar');
    }
    
    console.log('\n🚀 Bereit für die Discord-Bot Integration!');
});