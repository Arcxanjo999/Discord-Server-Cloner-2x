import type { Emoji, Guild, Role, VoiceChannel } from 'discord.js-selfbot-v13';
import gradient from 'gradient-string';
import type {
    BackupData,
    CategoryData,
    LoadOptions,
    TextChannelData,
    VoiceChannelData
} from './types';

import util from './util';
import { t } from '../utils/func';

/**
 * Restores the guild configuration
 */
export const loadConfig = (guild: Guild, backupData: BackupData): Promise<Guild[]> => {
    const configPromises: Promise<Guild>[] = [];

    if (backupData.name) configPromises.push(guild.setName(backupData.name));
    if (backupData.iconBase64) {
        configPromises.push(guild.setIcon(Buffer.from(backupData.iconBase64, 'base64')));
    } else if (backupData.iconURL) {
        configPromises.push(guild.setIcon(backupData.iconURL));
    }

    if (backupData.splashBase64) {
        configPromises.push(guild.setSplash(Buffer.from(backupData.splashBase64, 'base64')));
    } else if (backupData.splashURL) {
        configPromises.push(guild.setSplash(backupData.splashURL));
    }

    if (backupData.bannerBase64) {
        configPromises.push(guild.setBanner(Buffer.from(backupData.bannerBase64, 'base64')));
    } else if (backupData.bannerURL) {
        configPromises.push(guild.setBanner(backupData.bannerURL));
    }

    if (backupData.verificationLevel) {
        configPromises.push(guild.setVerificationLevel(backupData.verificationLevel));
    }

    if (backupData.defaultMessageNotifications) {
        configPromises.push(
            guild.setDefaultMessageNotifications(backupData.defaultMessageNotifications)
        );
    }

    const canChangeExplicit = guild.features.includes('COMMUNITY');
    if (backupData.explicitContentFilter && canChangeExplicit) {
        configPromises.push(
            guild.setExplicitContentFilter(backupData.explicitContentFilter)
        );
    }

    return Promise.all(configPromises);
};

/**
 * Restore roles
 */
export const loadRoles = async (guild: Guild, backupData: BackupData): Promise<Role[]> => {
    const rolePromises: Promise<Role>[] = [];

    backupData.roles.forEach((roleData) => {
        if (roleData.isEveryone) {
            const everyone = guild.roles.cache.get(guild.id);
            if (everyone) {
                rolePromises.push(
                    everyone.edit({
                        name: roleData.name,
                        color: roleData.color,
                        permissions: BigInt(roleData.permissions),
                        mentionable: roleData.mentionable
                    })
                );
            }
        } else {
            rolePromises.push(
                guild.roles.create({
                    name: roleData.name,
                    color: roleData.color,
                    hoist: roleData.hoist,
                    permissions: BigInt(roleData.permissions),
                    mentionable: roleData.mentionable
                }).then((role) => {
                    console.log(
                        gradient(['#ffcc00', '#0099cc', '#9933cc'])(
                            t('rolecreate') + role.name
                        )
                    );
                    return role;
                })
            );
        }
    });

    return Promise.all(rolePromises);
};

/**
 * Restore channels
 */
export const loadChannels = async (
    guild: Guild,
    backupData: BackupData,
    options: LoadOptions
): Promise<unknown[]> => {
    const tasks: Promise<unknown>[] = [];

    for (const categoryData of backupData.channels.categories) {
        tasks.push(
            (async () => {
                try {
                    const category = await util.loadCategory(categoryData, guild);
                    console.log(
                        gradient(['#ff4500', '#ffa500', '#ff6347'])(
                            t('categorycreate') + category.name
                        )
                    );

                    for (const channelData of categoryData.children) {
                        try {
                            await util.loadChannel(channelData, guild, category, options);
                        } catch (err) {
                            console.error(`Error loading channel ${channelData.name}:`, err);
                        }
                    }
                } catch (err) {
                    console.error(`Error loading category ${categoryData.name}:`, err);
                }
            })()
        );
    }

    for (const channelData of backupData.channels.others) {
        tasks.push(
            (async () => {
                try {
                    await util.loadChannel(channelData, guild, null, options);
                } catch (err) {
                    console.error(
                        `Error loading other channel ${channelData.name}:`,
                        err
                    );
                }
            })()
        );
    }

    return Promise.all(tasks);
};

/**
 * Restore AFK
 */
export const loadAFK = (guild: Guild, backupData: BackupData): Promise<Guild[]> => {
    const tasks: Promise<Guild>[] = [];

    if (backupData.afk) {
        const afkChannel = guild.channels.cache.find(
            (ch) =>
                ch.name === backupData.afk.name &&
                ch.type === 'GUILD_VOICE'
        ) as VoiceChannel;

        if (afkChannel) {
            tasks.push(guild.setAFKChannel(afkChannel));
            tasks.push(guild.setAFKTimeout(backupData.afk.timeout));
        }
    }

    return Promise.all(tasks);
};

/**
 * Restore emojis
 */
export const loadEmojis = (guild: Guild, backupData: BackupData): Promise<Emoji[]> => {
    const emojiPromises: Promise<Emoji>[] = [];

    for (const emoji of backupData.emojis) {
        if (emoji.url) {
            emojiPromises.push(guild.emojis.create(emoji.url, emoji.name));
        } else if (emoji.base64) {
            emojiPromises.push(
                guild.emojis.create(
                    Buffer.from(emoji.base64, 'base64'),
                    emoji.name
                )
            );
        }
    }

    return Promise.all(emojiPromises);
};

/**
 * Restore widget
 */
export const loadEmbedChannel = (
    guild: Guild,
    backupData: BackupData
): Promise<Guild[]> => {
    if (!backupData.widget?.channel) return Promise.resolve([]);

    return Promise.all([
        guild.setWidgetSettings({
            enabled: backupData.widget.enabled,
            channel: guild.channels.cache.find(
                (ch) => ch.name === backupData.widget.channel
            )
        })
    ]);
};
