const settings = require('../settings');
const { sendInteractiveButtons } = require('../lib/interactiveButtons');

async function twilioCommand(sock, chatId, message) {
    await sendInteractiveButtons(sock, chatId, {
        text: `Hello! I am ${settings.botName}. Choose an option below to get started.`,
        footer: `${settings.botName} • by ${settings.botOwner}`,
        nativeButtons: [
            {
                name: 'cta_url',
                buttonParamsJson: JSON.stringify({
                    display_text: '🌐 Visit GitHub',
                    url: 'https://github.com/gatotkacabatu999-lab/Knightbot-MD',
                    merchant_url: 'https://github.com/gatotkacabatu999-lab/Knightbot-MD'
                })
            },
            {
                name: 'cta_call',
                buttonParamsJson: JSON.stringify({
                    display_text: '📞 Contact Owner',
                    id: `+${settings.ownerNumber}`
                })
            },
            {
                name: 'quick_reply',
                buttonParamsJson: JSON.stringify({
                    display_text: '💬 Get Help',
                    id: '.help'
                })
            }
        ]
    }, { quoted: message });
}

module.exports = twilioCommand;
