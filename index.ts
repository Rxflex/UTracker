import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import {
    Client,
    EmbedBuilder,
    Events,
    GatewayIntentBits,
    type TextChannel,
} from 'discord.js';
import Redis from 'ioredis';

const TOKEN = process.env.DISCORD_TOKEN;
const CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;
const APP_IDS =
    process.env.STEAM_APP_IDS?.split(',')
        .map((id) => id.trim())
        .filter((id) => id.length > 0) || [];
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
    clan_steamid?: string;
    announcement_body: {
        body: string;
        tags: string[];
        clanid?: string;
    };
    jsondata?: string;
}

interface SteamApiResponse {
    success: number;
    events: SteamEvent[];
}

const client = new Client({
    intents: [GatewayIntentBits.Guilds],
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
        // Headers
        .replace(/\[h1\](.*?)\[\/h1\]/gs, '# $1\n')
        .replace(/\[h2\](.*?)\[\/h2\]/gs, '## $1\n')
        .replace(/\[h3\](.*?)\[\/h3\]/gs, '### $1\n')
        // Text formatting
        .replace(/\[b\](.*?)\[\/b\]/gs, '**$1**')
        .replace(/\[i\](.*?)\[\/i\]/gs, '*$1*')
        .replace(/\[u\](.*?)\[\/u\]/gs, '__$1__')
        .replace(/\[strike\](.*?)\[\/strike\]/gs, '~~$1~~')
        // Links
        .replace(/\[url=["']?(.*?)["']?\](.*?)\[\/url\]/gs, '[$2]($1)')
        // Lists
        .replace(/\[list\]/gi, '')
        .replace(/\[\/list\]/gi, '')
        .replace(/\[\*\]/g, '• ')
        .replace(/\[\/\*\]/g, '')
        .replace(/\[\/\]/g, '') // Malformed closing tags
        // Spoilers
        .replace(/\[spoiler\](.*?)\[\/spoiler\]/gs, '||$1||')
        // Code
        .replace(/\[code\](.*?)\[\/code\]/gs, '```\n$1\n```')
        // Quotes
        .replace(/\[quote\](.*?)\[\/quote\]/gs, '> $1\n')
        // Images - extract URL only
        .replace(/\[img\](.*?)\[\/img\]/gs, '')
        // Paragraphs
        .replace(/\[\/p\]/gi, '\n')
        .replace(/\[p\]/gi, '')
        // Preformatted text
        .replace(/\[previewyoutube=.*?\]\[\/previewyoutube\]/gs, '')
        // Clean up multiple newlines
        .replace(/\n{3,}/g, '\n\n')
        .trim();

    if (formatted.length > 3500) {
        formatted = `${formatted.substring(0, 3500)}...\n\n[Read full patch notes on Steam]`;
    }

    return formatted;
}

async function checkUpdates() {
    for (const appId of APP_IDS) {
        try {
            const url = `https://store.steampowered.com/events/ajaxgetadjacentpartnerevents/?appid=${appId}&count_before=0&count_after=1`;
            const response = await fetch(url);
            const data = (await response.json()) as SteamApiResponse;

            const event = data.events[0];
            if (data.success === 1 && event) {
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

    const channel = (await client.channels.fetch(CHANNEL_ID)) as TextChannel;
    if (!channel) return;

    let imageUrl: string | null = null;
    const clanId = event.announcement_body.clanid;
    
    try {
        if (event.jsondata && clanId) {
            const jsonData = JSON.parse(event.jsondata);
            const titleImages = jsonData.localized_title_image;
            const capsuleImages = jsonData.localized_capsule_image;
            
            // Try title_image first, then capsule_image
            const imageFile =
                (Array.isArray(titleImages) && titleImages[0]) ||
                (Array.isArray(capsuleImages) && capsuleImages[0]);
            
            if (imageFile) {
                imageUrl = `https://clan.fastly.steamstatic.com/images/${clanId}/${imageFile}`;
            }
        }
    } catch {
        // JSON parsing failed, skip image
    }

    const embed = new EmbedBuilder()
        .setTitle(event.event_name)
        .setURL(
            `https://store.steampowered.com/news/app/${event.appid}/view/${event.gid}`,
        )
        .setDescription(formatSteamText(event.announcement_body.body))
        .setColor(0x1b2838)
        .setTimestamp(new Date(event.rtime32_start_time * 1000))
        .setFooter({ text: `App ID: ${event.appid}` });

    if (imageUrl) {
        embed.setImage(imageUrl);
    }

    await channel.send({ embeds: [embed] });
}

client.once(Events.ClientReady, () => {
    console.log(`Logged in as ${client.user?.tag}`);
    checkUpdates();
    setInterval(checkUpdates, CHECK_INTERVAL);
});

if (!TOKEN) {
    process.exit(1);
}

client.login(TOKEN);
