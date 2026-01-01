import type {
  BackupData,
  BackupInfos,
  CreateOptions,
  LoadOptions,
} from "./types/";
import type { Guild } from "discord.js-selfbot-v13";
import { SnowflakeUtil, Intents } from "discord.js-selfbot-v13";

import nodeFetch from "node-fetch";
import { sep } from "path";

import {
  existsSync,
  mkdirSync,
  readdir,
  statSync,
  unlinkSync,
  writeFile,
} from "fs";
import { promisify } from "util";
const writeFileAsync = promisify(writeFile);
const readdirAsync = promisify(readdir);

import * as createMaster from "./create";
import * as loadMaster from "./load";
import * as utilMaster from "./util";

/* ===========================
   Utils
=========================== */

export async function executeWithRetry(
  operation: () => any,
  retrytents2 = 3
) {
  let retrytents = 0;
  while (retrytents < retrytents2) {
    try {
      await operation();
      return;
    } catch (error) {
      console.error(`Erro na clonagem (tentativa ${retrytents + 1}):`, error);
      retrytents++;
    }
  }
  throw new Error(`A clonagem falhou após ${retrytents2} tentativas`);
}

/* ===========================
   Storage
=========================== */

let cloner = `${__dirname}/cloner`;
if (!existsSync(cloner)) {
  mkdirSync(cloner);
}

const BACKUP_FILE = () => `${cloner}${sep}666.json`;

/* ===========================
   Backup loader (CORRIGIDO)
=========================== */

const getBackupData = async (_backupID: string) => {
  return new Promise<BackupData>((resolve, reject) => {
    try {
      const filePath = BACKUP_FILE();

      if (!existsSync(filePath)) {
        return reject(
          "Nenhum backup encontrado.\n👉 Crie um backup antes de tentar clonar."
        );
      }

      const backupData: BackupData = require(filePath);
      resolve(backupData);
    } catch (err) {
      reject("Erro ao carregar o arquivo de backup.");
    }
  });
};

/* ===========================
   Fetch backup info
=========================== */

export const fetch = (backupID: string) => {
  return new Promise<BackupInfos>(async (resolve, reject) => {
    try {
      const backupData = await getBackupData(backupID);
      const size = statSync(BACKUP_FILE()).size;

      resolve({
        data: backupData,
        id: backupID,
        size: Number((size / 1024).toFixed(2)),
      });
    } catch (err) {
      reject(err);
    }
  });
};

/* ===========================
   Create backup
=========================== */

export const create = async (
  guild: Guild,
  options: CreateOptions = {
    backupID: null,
    maxMessagesPerChannel: 10,
    jsonSave: true,
    jsonBeautify: true,
    doNotBackup: [],
    saveImages: "",
  }
) => {
  return new Promise<BackupData>(async (resolve, reject) => {
    const intents = new Intents(guild.client.options.intents);
    if (!intents.has("GUILDS")) {
      return reject("GUILDS intent is required");
    }

    try {
      const backupData: BackupData = {
        name: guild.name,
        verificationLevel: guild.verificationLevel,
        explicitContentFilter: guild.explicitContentFilter,
        defaultMessageNotifications: guild.defaultMessageNotifications,
        afk: guild.afkChannel
          ? { name: guild.afkChannel.name, timeout: guild.afkTimeout }
          : null,
        widget: {
          enabled: guild.widgetEnabled,
          channel: guild.widgetChannel
            ? guild.widgetChannel.name
            : null,
        },
        channels: { categories: [], others: [] },
        roles: [],
        bans: [],
        emojis: [],
        createdTimestamp: Date.now(),
        guildID: guild.id,
        id: options.backupID ?? SnowflakeUtil.generate(Date.now()),
      };

      if (guild.iconURL()) {
        if (options.saveImages === "base64") {
          backupData.iconBase64 = (
            await nodeFetch(guild.iconURL({ dynamic: true })).then((r) =>
              r.buffer()
            )
          ).toString("base64");
        }
        backupData.iconURL = guild.iconURL({ dynamic: true });
      }

      if (!options.doNotBackup?.includes("roles")) {
        backupData.roles = await createMaster.getRoles(guild);
      }
      if (!options.doNotBackup?.includes("emojis")) {
        backupData.emojis = await createMaster.getEmojis(guild, options);
      }
      if (!options.doNotBackup?.includes("channels")) {
        backupData.channels = await createMaster.getChannels(guild, options);
      }

      if (options.jsonSave !== false) {
        const json = options.jsonBeautify
          ? JSON.stringify(backupData, null, 4)
          : JSON.stringify(backupData);

        await writeFileAsync(BACKUP_FILE(), json, "utf-8");
      }

      resolve(backupData);
    } catch (err) {
      reject(err);
    }
  });
};

/* ===========================
   Load backup (CORRIGIDO)
=========================== */

export const load = async (
  backup: string | BackupData,
  guild: Guild,
  options: LoadOptions = {
    clearGuildBeforeRestore: true,
    maxMessagesPerChannel: 10,
  }
) => {
  return new Promise(async (resolve, reject) => {
    if (!guild) return reject("Invalid guild");

    try {
      const backupData: BackupData =
        typeof backup === "string"
          ? await getBackupData(backup)
          : backup;

      if (options.clearGuildBeforeRestore !== false) {
        await executeWithRetry(() => utilMaster.clearGuild(guild));
      }

      await Promise.all([
        loadMaster.loadConfig(guild, backupData),
        executeWithRetry(() => loadMaster.loadRoles(guild, backupData)),
        executeWithRetry(() =>
          loadMaster.loadChannels(guild, backupData, options)
        ),
        loadMaster.loadAFK(guild, backupData),
        executeWithRetry(() => loadMaster.loadEmojis(guild, backupData)),
        loadMaster.loadEmbedChannel(guild, backupData),
      ]);

      resolve(backupData);
    } catch (err) {
      reject(
        "Não foi possível continuar a clonagem.\n" +
          "Nenhum backup válido foi encontrado.\n\n" +
          "👉 Crie um backup antes de clonar."
      );
    }
  });
};

/* ===========================
   Remove backup
=========================== */

export const remove = async () => {
  return new Promise<void>((resolve, reject) => {
    try {
      if (!existsSync(BACKUP_FILE())) {
        return reject("Backup não encontrado");
      }
      unlinkSync(BACKUP_FILE());
      resolve();
    } catch {
      reject("Erro ao remover o backup");
    }
  });
};

/* ===========================
   List backups
=========================== */

export const list = async () => {
  const files = await readdirAsync(cloner);
  return files.filter((f) => f.endsWith(".json")).map((f) => f.split(".")[0]);
};

/* ===========================
   Change storage folder
=========================== */

export const setStorageFolder = (path: string) => {
  if (path.endsWith(sep)) path = path.slice(0, -1);
  cloner = path;
  if (!existsSync(cloner)) mkdirSync(cloner);
};

export default {
  create,
  fetch,
  list,
  load,
  remove,
};
