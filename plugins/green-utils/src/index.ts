import { instead, before, after } from "@vendetta/patcher";
import { findByName, findByProps, findByStoreName } from "@vendetta/metro";
import { storage } from "@vendetta/plugin";
import { React, ReactNative } from "@vendetta/metro/common";
import Settings from "./Settings";

const { Text, View, TouchableOpacity, StyleSheet, Alert } = ReactNative;

interface PluginStorage {
  imageBlockList: Record<string, boolean>;
  channelPasswords: Record<string, string>;
  channelLockList: Record<string, boolean>;
}

const pluginStorage = storage as unknown as PluginStorage;

pluginStorage.imageBlockList   ??= {};
pluginStorage.channelPasswords ??= {};
pluginStorage.channelLockList  ??= {};

const GuildStore = findByStoreName("GuildStore");
const ChannelStoreModule = findByProps("getLastSelectedChannelId") || findByProps("getChannel", "getGuildChannels");
const ChannelView = findByProps("ChannelChatWrapper") || findByProps("ChannelChat");
const ContextMenuModule = findByProps("openContextMenu", "openContextMenuLazy");
const ActionSheetModule = findByProps("openActionSheet", "hideActionSheet");
const alertModule = findByProps("showInputAlert");

const patches: (() => void)[] = [];
const unlockedChannels = new Set<string>();
const unlockedGuildImages = new Set<string>();

function simpleHash(str: string): string {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return h.toString(16);
}

function handleUnlockGuildImages(guildId: string): void {
  const channelId = ChannelStoreModule?.getLastSelectedChannelId?.();
  if (!channelId) return;

  const storedHash = pluginStorage.channelPasswords[channelId];
  if (!storedHash) {
    unlockedGuildImages.add(guildId);
    return;
  }

  const customAlert = alertModule?.showInputAlert;

  if (customAlert) {
    customAlert({
      title: "Images Locked",
      placeholder: "Enter active channel password...",
      secureTextEntry: true,
      confirmText: "Unlock",
      cancelText: "Cancel",
      onConfirm: (input: string) => {
        if (simpleHash(input ?? "") === storedHash) {
          unlockedGuildImages.add(guildId);
        } else {
          Alert.alert("Error", "Invalid Password Token");
        }
      }
    });
  } else if ((Alert as any).prompt) {
    (Alert as any).prompt(
      "Images Locked",
      "Enter active channel password to temporarily reveal server media:",
      [
        { text: "Cancel" },
        {
          text: "Unlock",
          onPress: (input?: string) => {
            if (simpleHash(input ?? "") === storedHash) {
              unlockedGuildImages.add(guildId);
            } else {
              Alert.alert("Error", "Invalid Password Token");
            }
          }
        }
      ],
      "secure-text"
    );
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

    if (guildId && pluginStorage.imageBlockList[guildId] && !unlockedGuildImages.has(guildId)) {
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
    }
  });

  patches.push(unpatch);
}

function initializeChannelLockPatch(): void {
  if (!ChannelView || !ChannelStoreModule) return;

  const targetMethod = "ChannelChatWrapper" in ChannelView ? "ChannelChatWrapper" : "default";

  const unpatch = instead(targetMethod, ChannelView, (args: any[], orig: Function) => {
    const channelId = ChannelStoreModule.getLastSelectedChannelId?.();

    if (channelId && pluginStorage.channelLockList[channelId] && !unlockedChannels.has(channelId)) {
      return React.createElement(LockScreen, {
        channelId,
        onUnlockCompleted: () => unlockedChannels.add(channelId)
      });
    }

    return orig(...args);
  });

  patches.push(unpatch);
}

function createActionObject(channelName: string, channelId: string, isLocked: boolean) {
  return {
    text: isLocked ? "Unlock (greenUtils)" : "Lock (greenUtils)",
    label: isLocked ? "Unlock (greenUtils)" : "Lock (greenUtils)",
    icon: isLocked ? "lock_open" : "lock",
    variant: isLocked ? "default" : "danger",
    onPress: () => {
      if (isLocked) {
        delete pluginStorage.channelLockList[channelId];
        delete pluginStorage.channelPasswords[channelId];
        Alert.alert("Success", `Channel #${channelName} unlocked completely.`);
      } else {
        const inputAlert = alertModule?.showInputAlert || (Alert as any).prompt;
        if (!inputAlert) {
          Alert.alert("Error", "No secure input popup discovered in this client version.");
          return;
        }

        if (inputAlert.name === "showInputAlert" || !Object.hasOwn(Alert, "prompt")) {
          inputAlert({
            title: "Lock Secure Channel",
            placeholder: "Set protection key text...",
            secureTextEntry: true,
            confirmText: "Apply Lock",
            cancelText: "Cancel",
            onConfirm: (text: string) => {
              if (!text || !text.trim()) {
                Alert.alert("Error", "Passwords cannot be blank.");
                return;
              }
              pluginStorage.channelLockList[channelId] = true;
              pluginStorage.channelPasswords[channelId] = simpleHash(text);
              Alert.alert("Success", `🔒 #${channelName} is now protected.`);
            }
          });
        } else {
          (Alert as any).prompt(
            "Lock Secure Channel",
            "Set protection key text:",
            [
              { text: "Cancel" },
              {
                text: "Apply Lock",
                onPress: (text?: string) => {
                  if (!text || !text.trim()) {
                    Alert.alert("Error", "Passwords cannot be blank.");
                    return;
                  }
                  pluginStorage.channelLockList[channelId] = true;
                  pluginStorage.channelPasswords[channelId] = simpleHash(text);
                  Alert.alert("Success", `🔒 #${channelName} is now protected.`);
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
    const methods = ["openContextMenu", "openContextMenuLazy"].filter(m => m in ContextMenuModule);
    for (const method of methods) {
      const unpatch = instead(method as any, ContextMenuModule, function (args, orig) {
        const [,, renderOptions] = args;
        if (renderOptions && typeof renderOptions === "object") {
          const channelId = renderOptions.channelId || renderOptions.channel?.id || renderOptions.id;
          if (channelId) {
            const channel = ChannelStoreModule?.getChannel?.(channelId);
            const channelName = channel?.name || "Channel";
            const isLocked = !!pluginStorage.channelLockList?.[channelId];
            const customAction = createActionObject(channelName, channelId, isLocked);
            
            if (Array.isArray(renderOptions.actions)) {
              renderOptions.actions.push(customAction);
            } else if (Array.isArray(renderOptions.sections?.[0]?.items)) {
              renderOptions.sections[0].items.push(customAction);
            } else {
              renderOptions.sections = [{ items: [customAction] }];
            }
          }
        }
        return orig.apply(this, args);
      });
      patches.push(unpatch);
    }
  }

  if (ActionSheetModule && "openActionSheet" in ActionSheetModule) {
    const unpatch = instead("openActionSheet", ActionSheetModule, function (args, orig) {
      const [,, config] = args;
      if (config && typeof config === "object") {
        const channelId = config.channelId || config.channel?.id || config.id;
        if (channelId) {
          const channel = ChannelStoreModule?.getChannel?.(channelId);
          const channelName = channel?.name || "Channel";
          const isLocked = !!pluginStorage.channelLockList?.[channelId];
          const customAction = createActionObject(channelName, channelId, isLocked);

          if (Array.isArray(config.options)) {
            config.options.push(customAction);
          } else if (Array.isArray(config.items)) {
            config.items.push(customAction);
          } else if (Array.isArray(config.actions)) {
            config.actions.push(customAction);
          }
        }
      }
      return orig.apply(this, args);
    });
    patches.push(unpatch);
  }
}

function LockScreen({ channelId, onUnlockCompleted }: any) {
  const styles = StyleSheet.create({
    container: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#313338", padding: 24 },
    icon:      { fontSize: 56, marginBottom: 16 },
    title:     { color: "#f2f3f5", fontSize: 20, fontWeight: "700", marginBottom: 8 },
    subtitle:  { color: "#80848e", fontSize: 14, marginBottom: 32, textAlign: "center" },
    btn:       { backgroundColor: "#5865f2", paddingHorizontal: 32, paddingVertical: 14, borderRadius: 8, width: "100%", alignItems: "center" },
    btnText:   { color: "#fff", fontSize: 16, fontWeight: "600" },
  });

  function handleUnlock() {
    const storedHash = pluginStorage.channelPasswords[channelId];
    const alertPrompt = alertModule?.showInputAlert || (Alert as any).prompt;
    
    if (alertPrompt) {
      if (typeof alertPrompt === "function" && alertPrompt.name === "showInputAlert") {
        alertPrompt({
          title: "Channel Locked",
          placeholder: "Enter password to unlock chat access:",
          secureTextEntry: true,
          confirmText: "Unlock",
          cancelText: "Cancel",
          onConfirm: (input: string) => {
            if (simpleHash(input ?? "") === storedHash) {
              onUnlockCompleted();
            } else {
              Alert.alert("Error", "Invalid Password Configuration");
            }
          }
        });
      } else {
        (Alert as any).prompt(
          "Channel Locked",
          "Enter password to unlock chat access:",
          [
            { text: "Cancel" },
            {
              text: "Unlock",
              onPress: (input?: string) => {
                if (simpleHash(input ?? "") === storedHash) {
                  onUnlockCompleted();
                } else {
                  Alert.alert("Error", "Invalid Password Configuration");
                }
              }
            }
          ],
          "secure-text"
        );
      }
    } else {
      Alert.alert("Device Error", "Unable to map prompt interfaces. Lift block thresholds in Settings.");
    }
  }

  return React.createElement(
    View, { style: styles.container },
    React.createElement(Text, { style: styles.icon }, "🔒"),
    React.createElement(Text, { style: styles.title }, "Channel Locked"),
    React.createElement(Text, { style: styles.subtitle }, "This room is restricted behind a ServerGuard credentials validation wall."),
    React.createElement(
      TouchableOpacity, { style: styles.btn, onPress: handleUnlock },
      React.createElement(Text, { style: styles.btnText }, "Tap to Unlock")
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
    unlockedChannels.clear();
    unlockedGuildImages.clear();
  },
};