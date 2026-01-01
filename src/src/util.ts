import type {
    CategoryData,
    ChannelPermissionsData,
    CreateOptions,
    LoadOptions,
    MessageData,
    TextChannelData,
    ThreadChannelData,
    VoiceChannelData
} from './types';

import type {
    CategoryChannel,
    Collection,
    Guild,
    GuildChannelCreateOptions,
    Message,
    OverwriteData,
    Snowflake,
    TextChannel,
    VoiceChannel,
    NewsChannel,
    PremiumTier,
    ThreadChannel
} from 'discord.js-selfbot-v13';

import nodeFetch from 'node-fetch';
import { configOptions2, t } from '../utils/func';
import gradient from 'gradient-string';

/* ===========================
   CONSTANTS (DISCORD SAFE)
=========================== */

const MIN_BITRATE = 8000;

const MaxBitratePerTier: Record<PremiumTier, number> = {
    NONE: 64000,
    TIER_1: 128000,
    TIER_2: 256000,
    TIER_3: 384000
};

/* ===========================
   PERMISSIONS (SAFE)
=========================== */

export function fetchChannelPermissions(
    channel: TextChannel | VoiceChannel | CategoryChannel | NewsChannel
): ChannelPermissionsData[] {

    const permissions: ChannelPermissionsData[] = [];

    try {
        channel.permissionOverwrites.cache
            .filter(p => p.type === 'role')
            .forEach(perm => {
                const role = channel.guild.roles.cache.get(perm.id);
                if (!role) return;

                permissions.push({
                    roleName: role.name,
                    allow: perm.allow.bitfield.toString(),
                    deny: perm.deny.bitfield.toString()
                });
            });
    } catch {}

    return permissions;
}

/* ===========================
   VOICE CHANNEL DATA
=========================== */

export async function fetchVoiceChannelData(
    channel: VoiceChannel
): Promise<VoiceChannelData> {

    return {
        type: 'GUILD_VOICE',
        name: channel.name,
        bitrate: Math.max(Number(channel.bitrate) || MIN_BITRATE, MIN_BITRATE),
        userLimit: channel.userLimit,
        parent: channel.parent ? channel.parent.name : null,
        permissions: fetchChannelPermissions(channel)
    };
}

/* ===========================
   FETCH MESSAGES (SAFE)
=========================== */

export async function fetchChannelMessages(
    channel: TextChannel | NewsChannel | ThreadChannel,
    options: CreateOptions
): Promise<MessageData[]> {

    const messages: MessageData[] = [];
    const limit = isNaN(options.maxMessagesPerChannel)
        ? 10
        : options.maxMessagesPerChannel;

    let lastId: Snowflake | undefined;

    while (messages.length < limit) {
        const fetched: Collection<Snowflake, Message> =
            await channel.messages.fetch({ limit: 100, before: lastId }).catch(() => null);

        if (!fetched || !fetched.size) break;
        lastId = fetched.last()?.id;

        for (const msg of fetched.values()) {
            if (!msg.author || messages.length >= limit) break;

            const files = await Promise.all(
                msg.attachments.map(async a => ({
                    name: a.name,
                    attachment:
                        options.saveImages === 'base64'
                            ? (await nodeFetch(a.url).then(r => r.buffer())).toString('base64')
                            : a.url
                })).catch(() => [])
            );

            messages.push({
                username: msg.author.username,
                avatar: msg.author.displayAvatarURL(),
                content: msg.cleanContent,
                embeds: msg.embeds,
                files,
                pinned: msg.pinned
            });
        }
    }

    return messages;
}

/* ===========================
   TEXT CHANNEL DATA
=========================== */

export async function fetchTextChannelData(
    channel: TextChannel | NewsChannel,
    options: CreateOptions
): Promise<TextChannelData> {

    const data: TextChannelData = {
        type: 'GUILD_TEXT', // 🔒 força compatibilidade
        name: channel.name,
        nsfw: Boolean(channel.nsfw),
        rateLimitPerUser: channel.rateLimitPerUser ?? undefined,
        parent: channel.parent ? channel.parent.name : null,
        topic: channel.topic ?? undefined,
        permissions: fetchChannelPermissions(channel),
        messages: [],
        isNews: false, // 🔒 nunca recriar como NEWS
        threads: []
    };

    for (const thread of channel.threads.cache.values()) {
        data.threads.push({
            type: thread.type,
            name: thread.name,
            archived: thread.archived,
            autoArchiveDuration: thread.autoArchiveDuration,
            locked: thread.locked,
            rateLimitPerUser: thread.rateLimitPerUser,
            messages: await fetchChannelMessages(thread, options)
        });
    }

    return data;
}

/* ===========================
   LOAD CATEGORY
=========================== */

export async function loadCategory(
    categoryData: CategoryData,
    guild: Guild
): Promise<CategoryChannel> {

    const category = await guild.channels.create(categoryData.name, {
        type: 'GUILD_CATEGORY'
    });

    const overwrites: OverwriteData[] = [];

    categoryData.permissions.forEach(p => {
        const role = guild.roles.cache.find(r => r.name === p.roleName);
        if (!role) return;

        overwrites.push({
            id: role.id,
            allow: BigInt(p.allow),
            deny: BigInt(p.deny)
        });
    });

    await category.permissionOverwrites.set(overwrites).catch(() => {});
    return category;
}

/* ===========================
   LOAD CHANNEL (ULTRA BLINDADO)
=========================== */

export async function loadChannel(
    channelData: TextChannelData | VoiceChannelData,
    guild: Guild,
    category?: CategoryChannel,
    options?: LoadOptions
): Promise<void> {

    try {
        if (
            channelData.name.startsWith('ticket-') &&
            configOptions2.ignoreTickets
        ) return;

        const createOptions: GuildChannelCreateOptions = {
            parent: category ?? undefined
        };

        /* 🔒 TEXT ONLY (NO NEWS, NO TYPE 5) */
        if (channelData.type !== 'GUILD_VOICE') {
            const text = channelData as TextChannelData;

            createOptions.type = 'GUILD_TEXT';
            createOptions.topic = text.topic ?? undefined;
            createOptions.nsfw = Boolean(text.nsfw);

            if (
                typeof text.rateLimitPerUser === 'number' &&
                text.rateLimitPerUser >= 0
            ) {
                createOptions.rateLimitPerUser = text.rateLimitPerUser;
            }
        }

        /* 🔊 VOICE (BITRATE 100% SAFE) */
        if (channelData.type === 'GUILD_VOICE') {
            const voice = channelData as VoiceChannelData;

            const max = MaxBitratePerTier[guild.premiumTier] ?? 64000;

            let bitrate = Number(voice.bitrate) || MIN_BITRATE;
            bitrate = Math.max(MIN_BITRATE, Math.min(bitrate, max));

            createOptions.type = 'GUILD_VOICE';
            createOptions.bitrate = bitrate;

            if (
                typeof voice.userLimit === 'number' &&
                voice.userLimit >= 0 &&
                voice.userLimit <= 99
            ) {
                createOptions.userLimit = voice.userLimit;
            }
        }

        const channel = await guild.channels.create(
            channelData.name,
            createOptions
        );

        const overwrites: OverwriteData[] = [];

        channelData.permissions.forEach(p => {
            const role = guild.roles.cache.find(r => r.name === p.roleName);
            if (!role) return;

            overwrites.push({
                id: role.id,
                allow: BigInt(p.allow),
                deny: BigInt(p.deny)
            });
        });

        await channel.permissionOverwrites.set(overwrites).catch(() => {});

        console.log(
            gradient(['#43a1ff', '#8a3ffc'])(
                t('channelcreate') + channelData.name
            )
        );

    } catch (err) {
        console.error(`⚠️ Canal ignorado (segurança): ${channelData.name}`);
    }
}

/* ===========================
   CLEAR GUILD (SAFE)
=========================== */

export async function clearGuild(guild: Guild) {

    for (const role of guild.roles.cache.values()) {
        if (!role.managed && role.editable && role.id !== guild.id) {
            await role.delete().catch(() => {});
        }
    }

    for (const channel of guild.channels.cache.values()) {
        await channel.delete().catch(() => {});
    }

    for (const emoji of guild.emojis.cache.values()) {
        await emoji.delete().catch(() => {});
    }

    try {
        const webhooks = await guild.fetchWebhooks();
        for (const webhook of webhooks.values()) {
            await webhook.delete().catch(() => {});
        }
    } catch {}

    await guild.setAFKChannel(null).catch(() => {});
    await guild.setAFKTimeout(300).catch(() => {});
    await guild.setIcon(null).catch(() => {});
    await guild.setBanner(null).catch(() => {});
    await guild.setSplash(null).catch(() => {});
    await guild.setDefaultMessageNotifications('ONLY_MENTIONS').catch(() => {});
    await guild.setWidgetSettings({ enabled: false, channel: null }).catch(() => {});
    await guild.setSystemChannel(null).catch(() => {});
    await guild.setVerificationLevel('NONE').catch(() => {});
    await guild.setExplicitContentFilter('DISABLED').catch(() => {});
}

/* ===========================
   EXPORTS
=========================== */

export default {
    fetchChannelPermissions,
    fetchVoiceChannelData,
    fetchChannelMessages,
    fetchTextChannelData,
    loadCategory,
    loadChannel,
    clearGuild
};
