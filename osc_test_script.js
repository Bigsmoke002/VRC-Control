// addons/vrc-control/osc_test.js
// OSC-Test und Debugging-Script für VRChat Control

const dgram = require('dgram');
const readline = require('readline');

class OSCTester {
    constructor() {
        this.client = dgram.createSocket('udp4');
        this.server = dgram.createSocket('udp4');
        this.config = {
            outPort: 9000,      // VRChat Input
            inPort: 9001,       // VRChat Output  
            host: '127.0.0.1'
        };
        
        this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
        
        this.isListening = false;
        this.init();
    }
    
    init() {
        console.log('🧪 VRChat OSC Tester gestartet');
        console.log('=====================================');
        console.log(`📤 Sende an VRChat: ${this.config.host}:${this.config.outPort}`);
        console.log(`📥 Höre von VRChat: ${this.config.inPort}`);
        console.log('');
        
        this.setupServer();
        this.showMenu();
    }
    
    setupServer() {
        this.server.on('message', (msg, rinfo) => {
            try {
                const parsed = this.parseOSCMessage(msg);
                console.log(`\n📥 [${new Date().toLocaleTimeString()}] Von ${rinfo.address}:${rinfo.port}:`);
                console.log(`   Address: ${parsed.address}`);
                console.log(`   Args: ${JSON.stringify(parsed.args)}`);
            } catch (error) {
                console.log(`\n❌ Fehler beim Parsen: ${error.message}`);
                console.log(`   Raw: ${msg.toString('hex')}`);
            }
        });
        
        this.server.on('error', (err) => {
            console.error(`❌ Server-Fehler: ${err.message}`);
        });
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
                if (Number.isInteger(arg)) {
                    const buf = Buffer.alloc(4);
                    buf.writeInt32BE(arg);
                    return buf;
                } else {
                    const buf = Buffer.alloc(4);
                    buf.writeFloatBE(arg);
                    return buf;
                }
            }
            if (typeof arg === 'boolean') {
                return Buffer.alloc(0);
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
                case 'i':
                    args.push(buffer.readInt32BE(offset));
                    offset += 4;
                    break;
                case 'f':
                    args.push(buffer.readFloatBE(offset));
                    offset += 4;
                    break;
                case 's':
                    const stringEnd = buffer.indexOf(0, offset);
                    args.push(buffer.toString('utf8', offset, stringEnd));
                    offset = Math.ceil((stringEnd + 1) / 4) * 4;
                    break;
                case 'T':
                    args.push(true);
                    break;
                case 'F':
                    args.push(false);
                    break;
            }
        }
        
        return { address, args };
    }
    
    sendMessage(address, args = []) {
        try {
            const message = this.buildOSCMessage(address, args);
            this.client.send(message, this.config.outPort, this.config.host, (err) => {
                if (err) {
                    console.log(`❌ Sende-Fehler: ${err.message}`);
                } else {
                    console.log(`📤 Gesendet: ${address} ${JSON.stringify(args)}`);
                }
            });
        } catch (error) {
            console.log(`❌ Build-Fehler: ${error.message}`);
        }
    }
    
    startListening() {
        if (this.isListening) {
            console.log('⚠️  Server hört bereits zu');
            return;
        }
        
        this.server.bind(this.config.inPort, () => {
            console.log(`👂 Höre auf Port ${this.config.inPort} für VRChat-Nachrichten...`);
            this.isListening = true;
        });
    }
    
    stopListening() {
        if (!this.isListening) {
            console.log('⚠️  Server hört nicht zu');
            return;
        }
        
        this.server.close(() => {
            console.log('🔇 Server gestoppt');
            this.isListening = false;
        });
    }
    
    showMenu() {
        console.log('\n🎯 Verfügbare Tests:');
        console.log('=====================================');
        console.log('1  - Chatbox-Nachricht senden');
        console.log('2  - Avatar-Parameter setzen');
        console.log('3  - VRCEmote testen (1-8)');
        console.log('4  - Gesichtsanimation testen');
        console.log('5  - Custom Parameter testen');
        console.log('6  - Heartbeat-Animation starten');
        console.log('7  - Chatbox-Loop starten');
        console.log('');
        console.log('l  - Listening starten/stoppen');
        console.log('s  - Status anzeigen');
        console.log('h  - Hilfe anzeigen');
        console.log('q  - Beenden');
        console.log('');
        
        this.waitForInput();
    }
    
    waitForInput() {
        this.rl.question('Eingabe: ', (input) => {
            this.handleInput(input.trim().toLowerCase());
        });
    }
    
    handleInput(input) {
        switch (input) {
            case '1':
                this.testChatbox();
                break;
            case '2':
                this.testParameter();
                break;
            case '3':
                this.testEmote();
                break;
            case '4':
                this.testFaceAnimation();
                break;
            case '5':
                this.testCustomParameter();
                break;
            case '6':
                this.startHeartbeat();
                break;
            case '7':
                this.startChatboxLoop();
                break;
            case 'l':
                if (this.isListening) {
                    this.stopListening();
                } else {
                    this.startListening();
                }
                this.waitForInput();
                break;
            case 's':
                this.showStatus();
                break;
            case 'h':
                this.showHelp();
                break;
            case 'q':
                this.quit();
                break;
            default:
                console.log('❓ Unbekannte Eingabe. Verwende "h" für Hilfe.');
                this.waitForInput();
        }
    }
    
    testChatbox() {
        this.rl.question('Chatbox-Nachricht (max 144 Zeichen): ', (message) => {
            if (message.length > 144) {
                message = message.substring(0, 141) + '...';
                console.log('⚠️  Nachricht auf 144 Zeichen gekürzt');
            }
            
            this.sendMessage('/chatbox/input', [message, true, true]);
            this.waitForInput();
        });
    }
    
    testParameter() {
        this.rl.question('Parameter-Name: ', (paramName) => {
            this.rl.question('Wert (0.0-1.0): ', (value) => {
                const floatValue = parseFloat(value);
                if (isNaN(floatValue)) {
                    console.log('❌ Ungültiger Wert');
                    this.waitForInput();
                    return;
                }
                
                this.sendMessage(`/avatar/parameters/${paramName}`, [floatValue]);
                this.waitForInput();
            });
        });
    }
    
    testEmote() {
        this.rl.question('Emote-Nummer (1-8): ', (emoteNum) => {
            const num = parseInt(emoteNum);
            if (num < 1 || num > 8 || isNaN(num)) {
                console.log('❌ Ungültige Emote-Nummer (1-8)');
                this.waitForInput();
                return;
            }
            
            console.log(`🎭 Sende Emote ${num}...`);
            this.sendMessage('/avatar/parameters/VRCEmote', [num]);
            
            // Reset nach 3 Sekunden
            setTimeout(() => {
                this.sendMessage('/avatar/parameters/VRCEmote', [0]);
                console.log('🔄 Emote zurückgesetzt');
            }, 3000);
            
            this.waitForInput();
        });
    }
    
    testFaceAnimation() {
        console.log('👤 Teste Gesichtsanimation...');
        
        // Gesicht nach links-oben bewegen
        this.sendMessage('/avatar/parameters/VRCFaceBlendH', [-0.5]);
        this.sendMessage('/avatar/parameters/VRCFaceBlendV', [0.5]);
        
        setTimeout(() => {
            // Gesicht nach rechts-unten bewegen
            this.sendMessage('/avatar/parameters/VRCFaceBlendH', [0.5]);
            this.sendMessage('/avatar/parameters/VRCFaceBlendV', [-0.5]);
            
            setTimeout(() => {
                // Zurück zur Mitte
                this.sendMessage('/avatar/parameters/VRCFaceBlendH', [0.0]);
                this.sendMessage('/avatar/parameters/VRCFaceBlendV', [0.0]);
                console.log('✅ Gesichtsanimation abgeschlossen');
            }, 1000);
        }, 1000);
        
        this.waitForInput();
    }
    
    testCustomParameter() {
        this.rl.question('Custom Parameter-Name: ', (paramName) => {
            console.log(`🔄 Teste ${paramName} mit verschiedenen Werten...`);
            
            let step = 0;
            const values = [0.0, 0.25, 0.5, 0.75, 1.0, 0.75, 0.5, 0.25, 0.0];
            
            const interval = setInterval(() => {
                if (step >= values.length) {
                    clearInterval(interval);
                    console.log('✅ Custom Parameter Test abgeschlossen');
                    this.waitForInput();
                    return;
                }
                
                const value = values[step];
                this.sendMessage(`/avatar/parameters/${paramName}`, [value]);
                console.log(`   ${paramName} = ${value}`);
                step++;
            }, 500);
        });
    }
    
    startHeartbeat() {
        this.rl.question('Parameter-Name für Heartbeat: ', (paramName) => {
            console.log(`💓 Starte Heartbeat für ${paramName} (30 Sekunden)...`);
            console.log('   Drücke Strg+C zum Stoppen');
            
            let startTime = Date.now();
            const interval = setInterval(() => {
                const elapsed = Date.now() - startTime;
                if (elapsed > 30000) {
                    clearInterval(interval);
                    console.log('✅ Heartbeat beendet');
                    this.waitForInput();
                    return;
                }
                
                const value = Math.sin(elapsed / 1000) * 0.5 + 0.5;
                this.sendMessage(`/avatar/parameters/${paramName}`, [value]);
            }, 100);
        });
    }
    
    startChatboxLoop() {
        console.log('🔄 Starte Chatbox-Loop (Zeit anzeigen, 5 Sekunden)...');
        console.log('   Drücke Strg+C zum Stoppen');
        
        const interval = setInterval(() => {
            const time = new Date().toLocaleTimeString('de-DE');
            this.sendMessage('/chatbox/input', [`🕐 ${time}`, true, false]);
        }, 5000);
        
        setTimeout(() => {
            clearInterval(interval);
            console.log('✅ Chatbox-Loop beendet');
            this.waitForInput();
        }, 30000);
    }
    
    showStatus() {
        console.log('\n📊 OSC-Tester Status:');
        console.log('=====================================');
        console.log(`📤 Sende-Port: ${this.config.outPort} (VRChat Input)`);
        console.log(`📥 Empfang-Port: ${this.config.inPort} (VRChat Output)`);
        console.log(`🌐 Host: ${this.config.host}`);
        console.log(`👂 Listening: ${this.isListening ? '✅ Aktiv' : '❌ Inaktiv'}`);
        console.log('');
        console.log('💡 VRChat OSC muss aktiviert sein:');
        console.log('   Action Menu → Options → OSC → Enabled ✅');
        console.log('');
        this.waitForInput();
    }
    
    showHelp() {
        console.log('\n📚 OSC-Tester Hilfe:');
        console.log('=====================================');
        console.log('');
        console.log('🎯 Zweck:');
        console.log('   Testen der OSC-Verbindung zu VRChat');
        console.log('   Debuggen von Chatbox und Avatar-Parametern');
        console.log('   Verstehen der OSC-Message-Struktur');
        console.log('');
        console.log('📋 Voraussetzungen:');
        console.log('   1. VRChat gestartet');
        console.log('   2. OSC in VRChat aktiviert');
        console.log('   3. Avatar mit Parametern geladen');
        console.log('');
        console.log('🔧 Häufige Parameter:');
        console.log('   VRCEmote: 0-8 (Standard-Emotes)');
        console.log('   VRCFaceBlendH: -1 bis 1 (Gesicht horizontal)');
        console.log('   VRCFaceBlendV: -1 bis 1 (Gesicht vertikal)');
        console.log('   Custom: Avatar-spezifische Parameter');
        console.log('');
        console.log('⚠️  Troubleshooting:');
        console.log('   - VRChat OSC aktiviert?');
        console.log('   - Firewall blockiert Port 9000/9001?');
        console.log('   - Avatar hat die Parameter?');
        console.log('   - Rate-Limits beachten (max 1 Chatbox/1.5s)');
        console.log('');
        this.waitForInput();
    }
    
    quit() {
        console.log('\n👋 OSC-Tester wird beendet...');
        
        if (this.isListening) {
            this.server.close();
        }
        
        this.client.close();
        this.rl.close();
        
        console.log('✅ Cleanup abgeschlossen. Auf Wiedersehen!');
        process.exit(0);
    }
}

// Script starten
if (require.main === module) {
    const tester = new OSCTester();
    
    // Graceful shutdown
    process.on('SIGINT', () => {
        console.log('\n\n🛑 Strg+C erkannt...');
        tester.quit();
    });
}

module.exports = OSCTester;