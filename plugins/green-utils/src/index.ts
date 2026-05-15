import { instead, before, after } from "@vendetta/patcher";
import { findByName, findByProps, findByStoreName } from "@vendetta/metro";
import { storage } from "@vendetta/plugin";
import { React, ReactNative } from "@vendetta/metro/common";
import Settings from "./Settings";

const { Text, View, TouchableOpacity, StyleSheet, Alert } = ReactNative;

interface PluginStorage {
  imageBlockList: Record<string, boolean>;
  serverPasswords: Record<string, string>;
  serverLockList: Record<string, boolean>;
  imageLockRequirePassword?: boolean;
}

const pluginStorage = storage as unknown as PluginStorage;

pluginStorage.imageBlockList   ??= {};
pluginStorage.serverPasswords  ??= {};
pluginStorage.serverLockList   ??= {};
pluginStorage.imageLockRequirePassword ??= false;

const GuildStore = findByStoreName("GuildStore");
const ChannelStoreModule = findByProps("getLastSelectedChannelId") || findByProps("getChannel", "getGuildChannels");
const ChannelView = findByProps("ChannelChatWrapper") || findByProps("ChannelChat");
const ActionSheetModule = findByProps("showSimpleActionSheet") || findByProps("openActionSheet");
const ContextMenuModule = findByProps("openContextMenuLazy") || findByProps("openContextMenu");
const alertModule = findByProps("showInputAlert");

const patches: (() => void)[] = [];
const unlockedGuilds = new Set<string>();

function simpleHash(str: string): string {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return h.toString(16);
}

function createActionObject(guildName: string, guildId: string, isLocked: boolean) {
  return {
    text: isLocked ? "Unlock Server (greenUtils)" : "Lock Server (greenUtils)",
    label: isLocked ? "Unlock Server (greenUtils)" : "Lock Server (greenUtils)",
    icon: isLocked ? "lock_open" : "lock",
    variant: isLocked ? "default" : "danger",
    onPress: () => {
      if (isLocked) {
        delete pluginStorage.serverLockList[guildId];
        delete pluginStorage.serverPasswords[guildId];
        unlockedGuilds.delete(guildId);
        Alert.alert("Success", `Server "${guildName}" safety restrictions removed.`);
      } else {
        const inputAlert = alertModule?.showInputAlert || (Alert as any).prompt;
        if (!inputAlert) {
          Alert.alert("Error", "No secure input popup discovered in this client version.");
          return;
        }

        if (inputAlert.name === "showInputAlert" || !Object.hasOwn(Alert, "prompt")) {
          inputAlert({
            title: "Lock Entire Server",
            placeholder: "Set encryption master key...",
            secureTextEntry: true,
            confirmText: "Lock Server",
            cancelText: "Cancel",
            onConfirm: (text: string) => {
              if (!text || !text.trim()) {
                Alert.alert("Error", "Passwords cannot be blank.");
                return;
              }
              pluginStorage.serverLockList[guildId] = true;
              pluginStorage.serverPasswords[guildId] = simpleHash(text);
              Alert.alert("Success", `🔒 "${guildName}" layout is now protected.`);
            }
          });
        } else {
          (Alert as any).prompt(
            "Lock Entire Server",
            "Set encryption master key:",
            [
              { text: "Cancel" },
              {
                text: "Lock Server",
                onPress: (text?: string) => {
                  if (!text || !text.trim()) {
                    Alert.alert("Error", "Passwords cannot be blank.");
                    return;
                  }
                  pluginStorage.serverLockList[guildId] = true;
                  pluginStorage.serverPasswords[guildId] = simpleHash(text);
                  Alert.alert("Success", `🔒 "${guildName}" layout is now protected.`);
                }
              }
            ],
            "secure-text"
          );
        }
      }
    }
  };
}

function patchChannelHoldMenu(): void {
  if (ContextMenuModule) {
    const methods = Object.keys(ContextMenuModule).filter(k => typeof (ContextMenuModule as any)[k] === "function");
    for (const method of methods) {
      const unpatch = instead(method as any, ContextMenuModule, function (args, orig) {
        const [,, renderOptions] = args;
        if (renderOptions && typeof renderOptions === "object") {
          const channelId = renderOptions.channelId || renderOptions.channel?.id || renderOptions.id;
          if (channelId) {
            const channel = ChannelStoreModule?.getChannel?.(channelId);
            const guildId = channel?.guild_id;
            if (guildId) {
              const guild = GuildStore?.getGuild?.(guildId);
              const guildName = guild?.name || "Server";
              const isLocked = !!pluginStorage.serverLockList?.[guildId];
              const customAction = createActionObject(guildName, guildId, isLocked);

              if (renderOptions.getRows) {
                const originalGetRows = renderOptions.getRows;
                renderOptions.getRows = function (...rowArgs: any[]) {
                  const rows = originalGetRows.apply(this, rowArgs);
                  if (Array.isArray(rows)) rows.push(customAction);
                  return rows;
                };
              }

              if (Array.isArray(renderOptions.options)) renderOptions.options.push(customAction);
              if (Array.isArray(renderOptions.items)) renderOptions.items.push(customAction);
              if (Array.isArray(renderOptions.actions)) renderOptions.actions.push(customAction);
            }
          }
        }
        return orig.apply(this, args);
      });
      patches.push(unpatch);
    }
  }

  if (ActionSheetModule) {
    const methods = Object.keys(ActionSheetModule).filter(k => typeof (ActionSheetModule as any)[k] === "function");
    for (const method of methods) {
      const unpatch = instead(method as any, ActionSheetModule, function (args, orig) {
        for (const arg of args) {
          if (arg && typeof arg === "object") {
            const channelId = arg.channelId || arg.channel?.id || arg.id;
            const guildId = arg.guildId || arg.guild?.id || ChannelStoreModule?.getChannel?.(channelId)?.guild_id;
            
            if (guildId && typeof guildId === "string" && guildId.length > 10) {
              const guild = GuildStore?.getGuild?.(guildId);
              const guildName = guild?.name || "Server";
              const isLocked = !!pluginStorage.serverLockList?.[guildId];
              const customAction = createActionObject(guildName, guildId, isLocked);

              if (Array.isArray(arg.options)) arg.options.push(customAction);
              if (Array.isArray(arg.items)) arg.items.push(customAction);
              if (Array.isArray(arg.actions)) arg.actions.push(customAction);
              if (arg.sections?.[0]?.items) arg.sections[0].items.push(customAction);
            }
          }
        }
        return orig.apply(this, args);
      });
      patches.push(unpatch);
    }
  }
}

function patchImageBlocking(): void {
  const createMessageContent = findByName("createMessageContent", false);
  const getChannel = findByProps("getChannel")?.getChannel;

  if (!createMessageContent || !getChannel) return;

  const unpatch = before("default", createMessageContent, (args: any[]) => {
    const content = args[0];
    if (!content?.message?.channel_id || !content?.options) return;

    const channel = getChannel(content.message.channel_id);
    const guildId = channel?.guild_id;

    if (guildId && pluginStorage.imageBlockList[guildId]) {
      if (pluginStorage.imageLockRequirePassword && !unlockedGuilds.has(guildId)) {
        content.options.inlineEmbedMedia = false;
        content.options.shouldObscureSpoiler = true;

        const message = content.message;
        if (message?.attachments?.length) {
          for (const attachment of message.attachments) {
            attachment.spoiler = true;
          }
        }

        if (message?.embeds?.length) {
          for (const embed of message.embeds) {
            embed.type = "link";
            delete embed.image;
            delete embed.video;
            delete embed.thumbnail;
          }
        }
      } else if (!pluginStorage.imageLockRequirePassword) {
        content.options.inlineEmbedMedia = false;
        content.options.shouldObscureSpoiler = true;
        
        const message = content.message;
        if (message?.attachments?.length) {
          for (const attachment of message.attachments) {
            attachment.spoiler = true;
          }
        }
      }
    }
  });
  patches.push(unpatch);
}

function initializeChannelLockPatch(): void {
  if (!ChannelView || !ChannelStoreModule) return;
  const targetMethod = "ChannelChatWrapper" in ChannelView ? "ChannelChatWrapper" : "default";

  const unpatch = instead(targetMethod, ChannelView, (args: any[], orig: Function) => {
    const channelId = ChannelStoreModule.getLastSelectedChannelId?.();
    const channel = ChannelStoreModule?.getChannel?.(channelId);
    const guildId = channel?.guild_id;

    if (guildId && pluginStorage.serverLockList[guildId] && !unlockedGuilds.has(guildId)) {
      return React.createElement(LockScreen, {
        guildId,
        onUnlockCompleted: () => unlockedGuilds.add(guildId)
      });
    }
    return orig(...args);
  });
  patches.push(unpatch);
}

function LockScreen({ guildId, onUnlockCompleted }: any) {
  const styles = StyleSheet.create({
    container: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#313338", padding: 24 },
    icon:      { fontSize: 56, marginBottom: 16 },
    title:     { color: "#f2f3f5", fontSize: 20, fontWeight: "700", marginBottom: 8 },
    subtitle:  { color: "#80848e", fontSize: 14, marginBottom: 32, textAlign: "center" },
    btn:       { backgroundColor: "#5865f2", paddingHorizontal: 32, paddingVertical: 14, borderRadius: 8, width: "100%", alignItems: "center" },
    btnText:   { color: "#fff", fontSize: 16, fontWeight: "600" },
  });

  function handleUnlock() {
    const storedHash = pluginStorage.serverPasswords[guildId];
    const alertPrompt = alertModule?.showInputAlert || (Alert as any).prompt;
    
    if (alertPrompt) {
      if (typeof alertPrompt === "function" && alertPrompt.name === "showInputAlert") {
        alertPrompt({
          title: "Server Layout Restricted",
          placeholder: "Enter credentials to unlock server channels:",
          secureTextEntry: true,
          confirmText: "Access Server",
          cancelText: "Cancel",
          onConfirm: (input: string) => {
            if (simpleHash(input ?? "") === storedHash) {
              onUnlockCompleted();
            } else {
              Alert.alert("Error", "Invalid Security Credentials");
            }
          }
        });
      } else {
        (Alert as any).prompt(
          "Server Layout Restricted",
          "Enter credentials to unlock server channels:",
          [
            { text: "Cancel" },
            {
              text: "Access Server",
              onPress: (input?: string) => {
                if (simpleHash(input ?? "") === storedHash) {
                  onUnlockCompleted();
                } else {
                  Alert.alert("Error", "Invalid Security Credentials");
                }
              }
            }
          ],
          "secure-text"
        );
      }
    } else {
      Alert.alert("Device Error", "Failed to compile security prompt layers.");
    }
  }

  return React.createElement(
    View, { style: styles.container },
    React.createElement(Text, { style: styles.icon }, "🔒"),
    React.createElement(Text, { style: styles.title }, "Server Locked"),
    React.createElement(Text, { style: styles.subtitle }, "Access to this server's internal framework is restricted behind a master gateway wall."),
    React.createElement(
      TouchableOpacity, { style: styles.btn, onPress: handleUnlock },
      React.createElement(Text, { style: styles.btnText }, "Decrypt Server")
    )
  );
}

export default {
  settings: Settings,

  onLoad() {
    setTimeout(() => {
      try {
        patchImageBlocking();
        initializeChannelLockPatch();
        patchChannelHoldMenu();
      } catch (e) {
        console.error(e);
      }
    }, 1000);
  },

  onUnload() {
    patches.forEach((p) => p());
    patches.length = 0;
    unlockedGuilds.clear();
  },
};