const yts = require('yt-search');
const axios = require('axios');

const AXIOS_DEFAULTS = {
    timeout: 60000,
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*'
    }
};

async function tryRequest(getter, attempts = 3) {
    let lastError;
    for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
            return await getter();
        } catch (err) {
            lastError = err;
            if (attempt < attempts) await new Promise(r => setTimeout(r, 1000 * attempt));
        }
    }
    throw lastError;
}

async function getEliteProTech(url) {
    const res = await tryRequest(() => axios.get(`https://eliteprotech-apis.zone.id/ytdown?url=${encodeURIComponent(url)}&format=mp3`, AXIOS_DEFAULTS));
    if (res?.data?.success && res?.data?.downloadURL) return { download: res.data.downloadURL, title: res.data.title };
    throw new Error('EliteProTech returned no download');
}

async function getYupra(url) {
    const res = await tryRequest(() => axios.get(`https://api.yupra.my.id/api/downloader/ytmp3?url=${encodeURIComponent(url)}`, AXIOS_DEFAULTS));
    if (res?.data?.success && res?.data?.data?.download_url) return { download: res.data.data.download_url, title: res.data.data.title };
    throw new Error('Yupra returned no download');
}

async function getOkatsu(url) {
    const res = await tryRequest(() => axios.get(`https://okatsu-rolezapiiz.vercel.app/downloader/ytmp3?url=${encodeURIComponent(url)}`, AXIOS_DEFAULTS));
    if (res?.data?.dl) return { download: res.data.dl, title: res.data.title };
    throw new Error('Okatsu returned no download');
}

async function getKeith(url) {
    const res = await tryRequest(() => axios.get(`https://apis-keith.vercel.app/download/dlmp3?url=${encodeURIComponent(url)}`, AXIOS_DEFAULTS));
    if (res?.data?.status && res?.data?.result?.downloadUrl) return { download: res.data.result.downloadUrl, title: res.data.result.title };
    throw new Error('Keith API returned no download');
}

async function downloadBuffer(url) {
    try {
        const res = await axios.get(url, {
            responseType: 'arraybuffer',
            timeout: 90000,
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
            validateStatus: s => s >= 200 && s < 400,
            headers: { 'User-Agent': AXIOS_DEFAULTS.headers['User-Agent'], 'Accept': '*/*', 'Accept-Encoding': 'identity' }
        });
        const buf = Buffer.from(res.data);
        if (buf.length > 0) return buf;
    } catch (_) {}
    const res = await axios.get(url, {
        responseType: 'stream',
        timeout: 90000,
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        validateStatus: s => s >= 200 && s < 400,
        headers: { 'User-Agent': AXIOS_DEFAULTS.headers['User-Agent'], 'Accept': '*/*', 'Accept-Encoding': 'identity' }
    });
    const chunks = [];
    await new Promise((resolve, reject) => {
        res.data.on('data', c => chunks.push(c));
        res.data.on('end', resolve);
        res.data.on('error', reject);
    });
    return Buffer.concat(chunks);
}

async function playCommand(sock, chatId, message) {
    try {
        const text = message.message?.conversation || message.message?.extendedTextMessage?.text || '';
        const query = text.split(' ').slice(1).join(' ').trim();

        if (!query) {
            return await sock.sendMessage(chatId, {
                text: '🎵 Usage: *.music* <song name or YouTube link>'
            }, { quoted: message });
        }

        let video;
        if (query.includes('youtube.com') || query.includes('youtu.be')) {
            video = { url: query, title: query, thumbnail: null, timestamp: '' };
        } else {
            const search = await yts(query);
            if (!search?.videos?.length) {
                return await sock.sendMessage(chatId, { text: '❌ No results found.' }, { quoted: message });
            }
            video = search.videos[0];
        }

        await sock.sendMessage(chatId, {
            image: { url: video.thumbnail || `https://i.ytimg.com/vi/${(video.url.match(/v=([a-zA-Z0-9_-]{11})/) || [])[1]}/sddefault.jpg` },
            caption: `🎵 *${video.title}*\n⏱ ${video.timestamp || ''}\n\n_⏳ Downloading, please wait..._`
        }, { quoted: message });

        const apiMethods = [
            { name: 'EliteProTech', fn: () => getEliteProTech(video.url) },
            { name: 'Yupra', fn: () => getYupra(video.url) },
            { name: 'Okatsu', fn: () => getOkatsu(video.url) },
            { name: 'Keith', fn: () => getKeith(video.url) }
        ];

        let audioBuffer, audioTitle;
        let success = false;

        for (const api of apiMethods) {
            try {
                const data = await api.fn();
                if (!data?.download) { console.log(`[MUSIC] ${api.name} no URL`); continue; }
                const buf = await downloadBuffer(data.download);
                if (buf && buf.length > 0) {
                    audioBuffer = buf;
                    audioTitle = data.title || video.title || 'music';
                    success = true;
                    break;
                }
            } catch (e) {
                console.log(`[MUSIC] ${api.name} failed: ${e.message}`);
            }
        }

        if (!success || !audioBuffer) {
            return await sock.sendMessage(chatId, {
                text: '❌ Download failed. All sources unavailable. Try again later.'
            }, { quoted: message });
        }

        await sock.sendMessage(chatId, {
            audio: audioBuffer,
            mimetype: 'audio/mpeg',
            fileName: `${audioTitle.replace(/[^\w\s-]/g, '')}.mp3`,
            ptt: false
        }, { quoted: message });

    } catch (error) {
        console.error('[MUSIC] Error:', error.message);
        await sock.sendMessage(chatId, {
            text: '❌ Download failed. Please try again later.'
        }, { quoted: message });
    }
}

module.exports = playCommand;
