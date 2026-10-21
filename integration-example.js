// Beispiel-Integration in deinen Discord-Bot
const { Client, GatewayIntentBits, Collection } = require('discord.js');

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
client.commands = new Collection();

// VRChat Control System laden
const vrchatControl = require('./addons/vrc-control/cmd_vrchatcontrol.js');
client.commands.set(vrchatControl.data.name, vrchatControl);

client.once('ready', () => {
    console.log(`🤖 Bot ist online als ${client.user.tag}`);
    
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
