let baileysCache = null

function getBaileys() {
    if (!baileysCache) {
        baileysCache = require('@whiskeysockets/baileys')
    }
    return baileysCache
}

function normalizeButtonName(name) {
    const raw = String(name || '').trim().toLowerCase()
    if (!raw) return ''
    if (raw === 'url' || raw === 'whatsapp') return 'cta_url'
    if (raw === 'call') return 'cta_call'
    if (raw === 'copy') return 'cta_copy'
    return raw
}

function parseParams(button) {
    const raw = button?.buttonParamsJson
    if (!raw) return null
    if (typeof raw === 'string') {
        try {
            return JSON.parse(raw)
        } catch (_) {
            return null
        }
    }
    if (typeof raw === 'object') return raw
    return null
}

function toNativeFlowButtons(buttons) {
    if (!Array.isArray(buttons)) return []

    const mapped = []
    for (const button of buttons) {
        if (!button || typeof button !== 'object') continue

        if (button.name && button.buttonParamsJson) {
            const allowedName = normalizeButtonName(button.name)
            const params = parseParams(button)

            if (allowedName === 'cta_url' && normalizeButtonName(button.name) === 'cta_url' && String(button.name || '').trim().toLowerCase() === 'whatsapp') {
                const phoneNumber = String(params?.phone_number || params?.phoneNumber || '').replace(/\D/g, '')
                const displayText = params?.display_text || params?.displayText || 'Open WhatsApp'
                const url = phoneNumber ? `https://wa.me/${phoneNumber}` : (params?.url || params?.link || '')
                if (!url) continue
                mapped.push({
                    name: 'cta_url',
                    buttonParamsJson: JSON.stringify({
                        display_text: displayText,
                        url,
                        merchant_url: url
                    })
                })
                continue
            }

            if (!allowedName) continue
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

function toLegacyButtons(buttons) {
    const nativeButtons = toNativeFlowButtons(buttons)
    const legacyButtons = nativeButtons
        .map((button, index) => {
            try {
                const params = JSON.parse(button.buttonParamsJson || '{}')
                const displayText = params.display_text || params.displayText || `Button ${index + 1}`
                const firstRowId = Array.isArray(params.sections)
                    ? params.sections.flatMap(section => Array.isArray(section?.rows) ? section.rows : []).find(row => row?.id)?.id
                    : ''
                const buttonId = params.id || params.buttonId || params.url || params.phone_number || params.copy_code || params.row_id || firstRowId || displayText
                return { buttonId: String(buttonId), buttonText: { displayText }, type: 1 }
            } catch (_) {
                return null
            }
        })
        .filter(Boolean)

    return legacyButtons
}

async function sendInteractiveButtons(sock, jid, payload, options = {}) {
    const bodyText = payload?.text || payload?.caption || ''
    const footerText = payload?.footer || ''
    const nativeButtons = toNativeFlowButtons(payload?.buttons || payload?.templateButtons || payload?.nativeButtons)
    const media = payload?.image || payload?.media || payload?.photo || null

    if (media) {
        const legacyButtons = toLegacyButtons(payload?.buttons || payload?.templateButtons || payload?.nativeButtons)
        try {
            await sock.sendMessage(jid, {
                image: media,
                caption: bodyText || ' ',
                footer: footerText,
                buttons: legacyButtons.length ? legacyButtons.slice(0, 3) : undefined,
                headerType: 1,
                viewOnce: true,
            }, options)
            return
        } catch (_) {
            if (!legacyButtons.length) {
                await sock.sendMessage(jid, {
                    image: media,
                    caption: bodyText || ' ',
                }, options)
                return
            }
        }
    }

    if (!nativeButtons.length) {
        if (media) {
            await sock.sendMessage(jid, {
                image: media,
                caption: bodyText || ' ',
            }, options)
            return
        }

        await sock.sendMessage(jid, { text: bodyText || ' ' }, options)
        return
    }

    try {
        const { generateWAMessageFromContent, proto } = getBaileys()
        const msg = generateWAMessageFromContent(jid, {
            viewOnceMessage: {
                message: {
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
                }
            }
        }, {
            userJid: sock?.user?.id,
            quoted: options?.quoted
        })

        await sock.relayMessage(jid, msg.message, { messageId: msg.key.id })
        return
    } catch (err) {
        const legacyButtons = toLegacyButtons(payload?.buttons || payload?.templateButtons || payload?.nativeButtons).slice(0, 3)

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
        || message?.message?.viewOnceMessage?.message?.buttonsResponseMessage?.selectedButtonId
    if (selectedLegacy) return selectedLegacy

    const paramsJson = message?.message?.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson
        || message?.message?.viewOnceMessage?.message?.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson
    if (!paramsJson || typeof paramsJson !== 'string') return ''

    try {
        const parsed = JSON.parse(paramsJson)
        return parsed.id || parsed.button_id || parsed.buttonId || parsed.row_id || parsed.selected_row_id || ''
    } catch (_) {
        return ''
    }
}

module.exports = {
    sendInteractiveButtons,
    toNativeFlowButtons,
    extractInteractiveResponseId
}
