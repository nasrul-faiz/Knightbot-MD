const settings = require('../settings');

async function twilioCommand(sock, chatId, message) {
    const templateButtons = [
        {
            urlButton: {
                displayText: '🌐 Visit GitHub',
                url: 'https://github.com/gatotkacabatu999-lab/Knightbot-MD'
            }
        },
        {
            callButton: {
                displayText: '📞 Contact Owner',
                phoneNumber: `+${settings.ownerNumber}`
            }
        },
        {
            quickReplyButton: {
                displayText: '💬 Get Help',
                id: '.help'
            }
        }
    ];

    await sock.sendMessage(chatId, {
        text: `Hello! I am ${settings.botName}. Choose an option below to get started.`,
        footer: `${settings.botName} • by ${settings.botOwner}`,
        templateButtons
    }, { quoted: message });
}

module.exports = twilioCommand;
