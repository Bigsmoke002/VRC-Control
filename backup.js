// addons/vrc-control/backup.js
// Backup und Restore System für VRChat Control Konfigurationen

const fs = require('fs');
const path = require('path');

const configFiles = [
    'web_config.json',
    'instances_config.json', 
    'vrc_control_config.json',
    'credentials.json'
];

const backupDir = path.join(__dirname, 'backups');

// Stelle sicher, dass Backup-Ordner existiert
if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
}

function formatDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    
    return `${year}-${month}-${day}_${hours}-${minutes}-${seconds}`;
}

function createBackup() {
    const timestamp = formatDate(new Date());
    const backupName = `backup_${timestamp}`;
    const backupPath = path.join(backupDir, backupName);
    
    console.log(`📦 Erstelle Backup: ${backupName}`);
    
    if (!fs.existsSync(backupPath)) {
        fs.mkdirSync(backupPath, { recursive: true });
    }
    
    let backedUpFiles = 0;
    let totalSize = 0;
    
    configFiles.forEach(file => {
        const sourcePath = path.join(__dirname, file);
        const destPath = path.join(backupPath, file);
        
        if (fs.existsSync(sourcePath)) {
            try {
                const stats = fs.statSync(sourcePath);
                fs.copyFileSync(sourcePath, destPath);
                
                backedUpFiles++;
                totalSize += stats.size;
                console.log(`✅ ${file} (${(stats.size / 1024).toFixed(2)} KB)`);
            } catch (error) {
                console.error(`❌ Fehler beim Backup von ${file}:`, error.message);
            }
        } else {
            console.log(`⚠️  ${file} nicht gefunden, überspringe...`);
        }
    });
    
    // Erstelle Backup-Info
    const backupInfo = {
        timestamp: new Date().toISOString(),
        files: backedUpFiles,
        totalSize: totalSize,
        version: "2.0",
        description: "VRChat Control System Backup"
    };
    
    fs.writeFileSync(
        path.join(backupPath, 'backup_info.json'), 
        JSON.stringify(backupInfo, null, 2)
    );
    
    console.log(`\n📊 Backup-Statistik:`);
    console.log(`   Dateien: ${backedUpFiles}/${configFiles.length}`);
    console.log(`   Größe: ${(totalSize / 1024).toFixed(2)} KB`);
    console.log(`   Pfad: ${backupPath}`);
    
    return backupName;
}

function listBackups() {
    console.log('📋 Verfügbare Backups:\n');
    
    if (!fs.existsSync(backupDir)) {
        console.log('Keine Backups gefunden.');
        return [];
    }
    
    const backups = fs.readdirSync(backupDir)
        .filter(item => {
            const itemPath = path.join(backupDir, item);
            return fs.statSync(itemPath).isDirectory() && item.startsWith('backup_');
        })
        .sort()
        .reverse(); // Neueste zuerst
    
    if (backups.length === 0) {
        console.log('Keine Backups gefunden.');
        return [];
    }
    
    backups.forEach((backup, index) => {
        const backupPath = path.join(backupDir, backup);
        const infoPath = path.join(backupPath, 'backup_info.json');
        
        let info = {};
        if (fs.existsSync(infoPath)) {
            try {
                info = JSON.parse(fs.readFileSync(infoPath, 'utf8'));
            } catch (error) {
                console.error(`Fehler beim Lesen von backup_info.json in ${backup}`);
            }
        }
        
        const date = info.timestamp ? new Date(info.timestamp).toLocaleString('de-DE') : 'Unbekannt';
        const files = info.files || '?';
        const size = info.totalSize ? `${(info.totalSize / 1024).toFixed(2)} KB` : '?';
        
        console.log(`${index + 1}. ${backup}`);
        console.log(`   📅 Datum: ${date}`);
        console.log(`   📁 Dateien: ${files}`);
        console.log(`   💾 Größe: ${size}`);
        console.log('');
    });
    
    return backups;
}

function restoreBackup(backupName) {
    const backupPath = path.join(backupDir, backupName);
    
    if (!fs.existsSync(backupPath)) {
        console.error(`❌ Backup '${backupName}' nicht gefunden!`);
        return false;
    }
    
    console.log(`🔄 Stelle Backup wieder her: ${backupName}`);
    
    let restoredFiles = 0;
    let errors = 0;
    
    // Erstelle Backup der aktuellen Konfiguration vor Restore
    console.log('💾 Erstelle Sicherheitsbackup der aktuellen Konfiguration...');
    const safetyBackup = createBackup();
    console.log(`✅ Sicherheitsbackup erstellt: ${safetyBackup}\n`);
    
    configFiles.forEach(file => {
        const sourcePath = path.join(backupPath, file);
        const destPath = path.join(__dirname, file);
        
        if (fs.existsSync(sourcePath)) {
            try {
                fs.copyFileSync(sourcePath, destPath);
                restoredFiles++;
                console.log(`✅ ${file} wiederhergestellt`);
            } catch (error) {
                console.error(`❌ Fehler beim Wiederherstellen von ${file}:`, error.message);
                errors++;
            }
        } else {
            console.log(`⚠️  ${file} im Backup nicht gefunden`);
        }
    });
    
    console.log(`\n📊 Restore-Statistik:`);
    console.log(`   Wiederhergestellt: ${restoredFiles}`);
    console.log(`   Fehler: ${errors}`);
    
    if (errors === 0) {
        console.log('✅ Backup erfolgreich wiederhergestellt!');
        console.log('💡 Starte das System neu, um die Änderungen zu übernehmen.');
    } else {
        console.log('⚠️  Restore mit Fehlern abgeschlossen.');
    }
    
    return errors === 0;
}

function cleanupOldBackups(keepCount = 10) {
    console.log(`🧹 Bereinige alte Backups (behalte die neuesten ${keepCount})...`);
    
    const backups = fs.readdirSync(backupDir)
        .filter(item => {
            const itemPath = path.join(backupDir, item);
            return fs.statSync(itemPath).isDirectory() && item.startsWith('backup_');
        })
        .sort()
        .reverse(); // Neueste zuerst
    
    if (backups.length <= keepCount) {
        console.log(`📊 ${backups.length} Backups gefunden, Bereinigung nicht nötig.`);
        return;
    }
    
    const toDelete = backups.slice(keepCount);
    let deletedCount = 0;
    
    toDelete.forEach(backup => {
        const backupPath = path.join(backupDir, backup);
        try {
            fs.rmSync(backupPath, { recursive: true, force: true });
            deletedCount++;
            console.log(`🗑️  ${backup} gelöscht`);
        } catch (error) {
            console.error(`❌ Fehler beim Löschen von ${backup}:`, error.message);
        }
    });
    
    console.log(`✅ ${deletedCount} alte Backups gelöscht, ${backups.length - deletedCount} behalten.`);
}

// Kommandozeilen-Interface
const args = process.argv.slice(2);
const command = args[0];

switch (command) {
    case 'create':
    case 'backup':
        createBackup();
        break;
        
    case 'list':
    case 'ls':
        listBackups();
        break;
        
    case 'restore':
        const backupName = args[1];
        if (!backupName) {
            console.error('❌ Backup-Name erforderlich!');
            console.log('💡 Verwende: node backup.js restore <backup_name>');
            console.log('💡 Oder: node backup.js list um verfügbare Backups zu sehen');
            process.exit(1);
        }
        restoreBackup(backupName);
        break;
        
    case 'cleanup':
        const keepCount = parseInt(args[1]) || 10;
        cleanupOldBackups(keepCount);
        break;
        
    case 'auto':
        // Automatisches Backup mit Cleanup
        console.log('🤖 Automatisches Backup...');
        createBackup();
        cleanupOldBackups(5); // Behalte nur 5 neueste
        break;
        
    default:
        console.log('📚 VRChat Control System - Backup & Restore');
        console.log('===========================================\n');
        console.log('Verfügbare Befehle:');
        console.log('  create, backup     - Erstellt ein neues Backup');
        console.log('  list, ls          - Zeigt alle verfügbaren Backups');
        console.log('  restore <name>    - Stellt ein Backup wieder her');
        console.log('  cleanup [anzahl]  - Löscht alte Backups (Standard: behalte 10)');
        console.log('  auto              - Erstellt Backup + Cleanup');
        console.log('\nBeispiele:');
        console.log('  node backup.js create');
        console.log('  node backup.js list');
        console.log('  node backup.js restore backup_2024-01-15_14-30-00');
        console.log('  node backup.js cleanup 5');
        break;
}

module.exports = {
    createBackup,
    listBackups,
    restoreBackup,
    cleanupOldBackups
};