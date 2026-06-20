const { generateWAMessageFromContent, proto } = require('@whiskeysockets/baileys')

function toNativeFlowButtons(buttons) {
    if (!Array.isArray(buttons)) return []

    const mapped = []
    for (const button of buttons) {
        if (!button || typeof button !== 'object') continue

        if (button.name && button.buttonParamsJson) {
            const allowedName = button.name === 'quick_reply' ? 'quick_reply' : button.name
            mapped.push({
                name: allowedName,
                buttonParamsJson: typeof button.buttonParamsJson === 'string'
                    ? button.buttonParamsJson
                    : JSON.stringify(button.buttonParamsJson)
            })
            continue
        }

        if (button.quickReplyButton?.id) {
            mapped.push({
                name: 'quick_reply',
                buttonParamsJson: JSON.stringify({
                    display_text: button.quickReplyButton.displayText || 'Button',
                    id: button.quickReplyButton.id
                })
            })
            continue
        }

        if (button.urlButton?.url) {
            mapped.push({
                name: 'cta_url',
                buttonParamsJson: JSON.stringify({
                    display_text: button.urlButton.displayText || 'Open Link',
                    url: button.urlButton.url,
                    merchant_url: button.urlButton.url
                })
            })
            continue
        }

        if (button.callButton?.phoneNumber) {
            mapped.push({
                name: 'cta_call',
                buttonParamsJson: JSON.stringify({
                    display_text: button.callButton.displayText || 'Call',
                    phone_number: String(button.callButton.phoneNumber)
                })
            })
            continue
        }

        if (button.buttonId || button.buttonText?.displayText) {
            mapped.push({
                name: 'quick_reply',
                buttonParamsJson: JSON.stringify({
                    display_text: button.buttonText?.displayText || 'Button',
                    id: button.buttonId || button.buttonText?.displayText
                })
            })
        }
    }

    return mapped
}

async function sendInteractiveButtons(sock, jid, payload, options = {}) {
    const bodyText = payload?.text || payload?.caption || ''
    const footerText = payload?.footer || ''
    const nativeButtons = toNativeFlowButtons(payload?.buttons || payload?.templateButtons || payload?.nativeButtons).slice(0, 3)

    if (!nativeButtons.length) {
        await sock.sendMessage(jid, { text: bodyText || ' ' }, options)
        return
    }

    try {
        const msg = generateWAMessageFromContent(jid, {
            messageContextInfo: {
                deviceListMetadata: {},
                deviceListMetadataVersion: 2
            },
            interactiveMessage: proto.Message.InteractiveMessage.create({
                body: proto.Message.InteractiveMessage.Body.create({
                    text: bodyText || ' '
                }),
                footer: proto.Message.InteractiveMessage.Footer.create({
                    text: footerText
                }),
                header: proto.Message.InteractiveMessage.Header.create({
                    hasMediaAttachment: false
                }),
                nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.create({
                    buttons: nativeButtons
                })
            })
        }, {
            userJid: sock?.user?.id,
            quoted: options?.quoted
        })

        await sock.relayMessage(jid, msg.message, { messageId: msg.key.id })
        return
    } catch (err) {
        const legacyButtons = nativeButtons
            .map((button, index) => {
                try {
                    const params = JSON.parse(button.buttonParamsJson || '{}')
                    const displayText = params.display_text || params.displayText || `Button ${index + 1}`
                    const buttonId = params.id || params.buttonId || params.url || params.phone_number || displayText
                    return { buttonId: String(buttonId), buttonText: { displayText }, type: 1 }
                } catch (_) {
                    return null
                }
            })
            .filter(Boolean)
            .slice(0, 3)

        if (legacyButtons.length) {
            await sock.sendMessage(jid, {
                text: bodyText || ' ',
                footer: footerText,
                buttons: legacyButtons,
                headerType: 1,
                viewOnce: true
            }, options)
            return
        }

        throw err
    }
}

function extractInteractiveResponseId(message) {
    const selectedLegacy = message?.message?.buttonsResponseMessage?.selectedButtonId
    if (selectedLegacy) return selectedLegacy

    const paramsJson = message?.message?.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson
    if (!paramsJson || typeof paramsJson !== 'string') return ''

    try {
        const parsed = JSON.parse(paramsJson)
        return parsed.id || parsed.button_id || parsed.buttonId || ''
    } catch (_) {
        return ''
    }
}

module.exports = {
    sendInteractiveButtons,
    toNativeFlowButtons,
    extractInteractiveResponseId
}
