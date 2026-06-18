const settings = require('../settings');

async function twilioCommand(sock, chatId, message) {
    const templateButtons = [
        {
            urlButton: {
                displayText: '🌐 Visit Website',
                url: 'https://example.com'
            }
        },
        {
            callButton: {
                displayText: '📞 Call Owner',
                phoneNumber: `+${settings.ownerNumber}`
            }
        },
        {
            quickReplyButton: {
                displayText: '💬 Help',
                id: '.help'
            }
        }
    ];

    await sock.sendMessage(chatId, {
        text: 'Here are your Twilio-style buttons:',
        footer: 'KnightBot MD',
        templateButtons: templateButtons
    }, { quoted: message });
}

module.exports = twilioCommand;
