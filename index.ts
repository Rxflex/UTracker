import { Client, GatewayIntentBits, EmbedBuilder, TextChannel } from 'discord.js';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import Redis from 'ioredis';

const TOKEN = process.env.DISCORD_TOKEN;
const CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;
const APP_IDS = process.env.STEAM_APP_IDS?.split(',').map(id => id.trim()).filter(id => id.length > 0) || [];
const CHECK_INTERVAL = parseInt(process.env.CHECK_INTERVAL_MS || '300000', 10);
const REDIS_URL = process.env.REDIS_URL;
const STORAGE_FILE = 'storage.json';

let redisClient: Redis | null = null;

if (REDIS_URL) {
    redisClient = new Redis(REDIS_URL);
    redisClient.on('error', (err) => console.error('Redis error:', err));
}

interface SteamEvent {
    gid: string;
    event_name: string;
    event_type: number;
    appid: number;
    rtime32_start_time: number;
    announcement_body: {
        body: string;
        tags: string[];
    };
    jsondata?: string;
}

interface SteamApiResponse {
    success: number;
    events: SteamEvent[];
}

const client = new Client({
    intents: [GatewayIntentBits.Guilds]
});

async function getLastGid(appId: string): Promise<string | null> {
    if (redisClient) {
        return await redisClient.get(`steam_watcher:${appId}`);
    } else {
        if (existsSync(STORAGE_FILE)) {
            try {
                const data = JSON.parse(readFileSync(STORAGE_FILE, 'utf-8'));
                return data[appId] || null;
            } catch {
                return null;
            }
        }
        return null;
    }
}

async function setLastGid(appId: string, gid: string) {
    if (redisClient) {
        await redisClient.set(`steam_watcher:${appId}`, gid);
    } else {
        let data: Record<string, string> = {};
        if (existsSync(STORAGE_FILE)) {
            try {
                data = JSON.parse(readFileSync(STORAGE_FILE, 'utf-8'));
            } catch {}
        }
        data[appId] = gid;
        writeFileSync(STORAGE_FILE, JSON.stringify(data, null, 2));
    }
}

function formatSteamText(text: string): string {
    let formatted = text
        .replace(/[\[]h1[\]](.*?)[\[]h1[\]]/g, '# $1\n')
        .replace(/[\[]h2[\]](.*?)[\[]h2[\]]/g, '## $1\n')
        .replace(/[\[]h3[\]](.*?)[\[]h3[\]]/g, '### $1\n')
        .replace(/[\[]b[\]](.*?)[\[]b[\]]/g, '**$1**')
        .replace(/[\[]i[\]](.*?)[\[]i[\]]/g, '*$1*')
        .replace(/[\[]u[\]](.*?)[\[]u[\]]/g, '__$1__')
        .replace(/[\[]strike[\]](.*?)[\[]strike[\]]/g, '~~$1~~')
        .replace(/[\[]url=(.*?)[\]](.*?)[\[]url[\]]/g, '[$2]($1)')
        .replace(/[\[]list[\]]/g, '')
        .replace(/[\[]list[\]]/g, '')
        .replace(/[\[]\*[\]]/g, '• ')
        .replace(/[\[]spoiler[\]](.*?)[\[]spoiler[\]]/g, '||$1||')
        .replace(/[\[]code[\]](.*?)[\[]code[\]]/g, '```\n$1\n```')
        .replace(/[\[]quote[\]](.*?)[\[]quote[\]]/g, '> $1\n')
        .replace(/[\[]img[\]](.*?)[\[]img[\]]/g, 'Image: $1')
        .replace(/[\[]\/?p[\]]/g, '\n');

    if (formatted.length > 3500) {
        formatted = formatted.substring(0, 3500) + '...\n\n[Read full patch notes on Steam]';
    }

    return formatted;
}

async function checkUpdates() {
    for (const appId of APP_IDS) {
        try {
            const url = `https://store.steampowered.com/events/ajaxgetadjacentpartnerevents/?appid=${appId}&count_before=0&count_after=1`;
            const response = await fetch(url);
            const data = await response.json() as SteamApiResponse;

            if (data.success === 1 && data.events.length > 0) {
                const event = data.events[0];
                const lastGid = await getLastGid(appId);

                if (event.gid !== lastGid) {
                    await sendDiscordNotification(event);
                    await setLastGid(appId, event.gid);
                }
            }
        } catch (error) {
            console.error(`Error checking updates for App ID ${appId}:`, error);
        }
    }
}

async function sendDiscordNotification(event: SteamEvent) {
    if (!CHANNEL_ID) return;

    const channel = await client.channels.fetch(CHANNEL_ID) as TextChannel;
    if (!channel) return;

    let imageUrl: string | null = null;
    try {
        if (event.jsondata) {
            const jsonData = JSON.parse(event.jsondata);
            const images = jsonData.localized_title_image;
            if (Array.isArray(images) && images[0]) {
                 imageUrl = `https://cdn.akamai.steamstatic.com/steamcommunity/public/images/clans/${event.clan_steamid}/${images[0]}`;
            }
        }
    } catch {}

    const embed = new EmbedBuilder()
        .setTitle(event.event_name)
        .setURL(`https://store.steampowered.com/news/app/${event.appid}/view/${event.gid}`)
        .setDescription(formatSteamText(event.announcement_body.body))
        .setColor(0x1b2838)
        .setTimestamp(new Date(event.rtime32_start_time * 1000))
        .setFooter({ text: `App ID: ${event.appid}` });

    if (imageUrl) {
        embed.setImage(imageUrl);
    }

    await channel.send({ embeds: [embed] });
}

client.once('ready', () => {
    console.log(`Logged in as ${client.user?.tag}`);
    checkUpdates();
    setInterval(checkUpdates, CHECK_INTERVAL);
});

if (!TOKEN) {
    process.exit(1);
}

client.login(TOKEN);