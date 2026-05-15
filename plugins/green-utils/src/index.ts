import { instead, before } from "@vendetta/patcher";
import { findByName, findByProps, findByStoreName } from "@vendetta/metro";
import { storage } from "@vendetta/plugin";
import { React, ReactNative } from "@vendetta/metro/common";
import Settings from "./Settings";

const { Text, View, TouchableOpacity, StyleSheet, Alert } = ReactNative;

interface PluginStorage {
  imageBlockList: Record<string, boolean>;
  serverPasswords: Record<string, string>;
  serverLockList: Record<string, boolean>;
  imageLockRequirePassword: boolean;
}

const pluginStorage = storage as unknown as PluginStorage;

pluginStorage.imageBlockList           ??= {};
pluginStorage.serverPasswords          ??= {};
pluginStorage.serverLockList           ??= {};
pluginStorage.imageLockRequirePassword ??= false;

const SelectedGuildStore = findByStoreName("SelectedGuildStore") || findByProps("getGuildId", "getLastSelectedGuildId");
const ChannelView = findByProps("ChannelChatWrapper") || findByProps("ChannelChat");
const alertModule = findByProps("showInputAlert");

const patches: (() => void)[] = [];
const unlockedGuilds = new Set<string>();
const unlockedImagesForGuild = new Set<string>();

function simpleHash(str: string): string {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return h.toString(16);
}

function triggerImageUnlockPopup(guildId: string, callback: () => void) {
  const storedHash = pluginStorage.serverPasswords[guildId];
  if (!storedHash) {
    unlockedImagesForGuild.add(guildId);
    callback();
    return;
  }

  const customAlert = alertModule?.showInputAlert;
  if (customAlert) {
    customAlert({
      title: "Images Locked",
      placeholder: "Enter password to view...",
      secureTextEntry: true,
      confirmText: "Unlock",
      cancelText: "Cancel",
      onConfirm: (input: string) => {
        if (simpleHash(input ?? "") === storedHash) {
          unlockedImagesForGuild.add(guildId);
          callback();
          forceUpdateChat();
        } else {
          Alert.alert("Error", "Invalid Password");
        }
      }
    });
  } else {
    Alert.alert("Unlock Required", "Please enter your password.");
  }
}

function patchImageBlocking(): void {
  // 1. Force message content to flag attachments as spoilers
  const createMessageContent = findByName("createMessageContent", false);
  if (createMessageContent) {
    const unpatchContent = before("default", createMessageContent, (args: any[]) => {
      const content = args[0];
      if (!content?.message || !content?.options) return;

      const guildId = SelectedGuildStore?.getGuildId?.() || SelectedGuildStore?.getLastSelectedGuildId?.();
      if (!guildId) return;

      if (pluginStorage.imageBlockList[guildId]) {
        if (pluginStorage.imageLockRequirePassword && !unlockedImagesForGuild.has(guildId)) {
          content.options.inlineEmbedMedia = false;
          content.options.shouldObscureSpoiler = true;

          if (content.message.attachments?.length) {
            for (const attachment of content.message.attachments) {
              attachment.spoiler = true;
            }
          }
        } else if (!pluginStorage.imageLockRequirePassword) {
          content.options.inlineEmbedMedia = false;
          content.options.shouldObscureSpoiler = true;
          if (content.message.attachments?.length) {
            for (const attachment of content.message.attachments) {
              attachment.spoiler = true;
            }
          }
        }
      }
    });
    patches.push(unpatchContent);
  }

  // 2. Wrap media viewer entry points completely to catch attachment taps
  const MediaViewerModule = findByProps("openMediaViewer", "showMediaViewer") || findByProps("handleClickMedia");
  if (MediaViewerModule) {
    const methodsToPatch = ["openMediaViewer", "showMediaViewer", "handleClickMedia"];
    for (const method of methodsToPatch) {
      if (typeof (MediaViewerModule as any)[method] === "function") {
        const unpatchMedia = instead(method, MediaViewerModule, function(args, orig) {
          const guildId = SelectedGuildStore?.getGuildId?.() || SelectedGuildStore?.getLastSelectedGuildId?.();
          if (guildId && pluginStorage.imageBlockList[guildId] && pluginStorage.imageLockRequirePassword && !unlockedImagesForGuild.has(guildId)) {
            triggerImageUnlockPopup(guildId, () => orig.apply(this, args));
            return;
          }
          return orig.apply(this, args);
        });
        patches.push(unpatchMedia);
      }
    }
  }
}

function initializeChannelLockPatch(): void {
  if (!ChannelView) return;
  const targetMethod = "ChannelChatWrapper" in ChannelView ? "ChannelChatWrapper" : "default";

  const unpatch = instead(targetMethod, ChannelView, (args: any[], orig: Function) => {
    const currentGuildId = SelectedGuildStore?.getGuildId?.() || SelectedGuildStore?.getLastSelectedGuildId?.();

    if (currentGuildId && pluginStorage.serverLockList[currentGuildId] && !unlockedGuilds.has(currentGuildId)) {
      return React.createElement(LockScreen, {
        guildId: currentGuildId,
        onUnlockCompleted: () => {
          unlockedGuilds.add(currentGuildId);
          forceUpdateChat();
        }
      });
    }

    return orig(...args);
  });
  patches.push(unpatch);
}

let forceUpdateChat = () => {};

function LockScreen({ guildId, onUnlockCompleted }: any) {
  const [, forceComponentUpdate] = React.useReducer((x) => x + 1, 0);
  
  React.useEffect(() => {
    forceUpdateChat = forceComponentUpdate;
  }, []);

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
    const alertPrompt = alertModule?.showInputAlert;
    
    if (alertPrompt) {
      alertPrompt({
        title: "Server Locked",
        placeholder: "Enter password...",
        secureTextEntry: true,
        confirmText: "Unlock",
        cancelText: "Cancel",
        onConfirm: (input: string) => {
          if (simpleHash(input ?? "") === storedHash) {
            onUnlockCompleted();
          } else {
            Alert.alert("Error", "Invalid Password");
          }
        }
      });
    } else {
      Alert.alert("Error", "Secure popup module missing.");
    }
  }

  return React.createElement(
    View, { style: styles.container },
    React.createElement(Text, { style: styles.icon }, "🔒"),
    React.createElement(Text, { style: styles.title }, "Server Locked"),
    React.createElement(Text, { style: styles.subtitle }, "This server is locked behind a password."),
    React.createElement(
      TouchableOpacity, { style: styles.btn, onPress: handleUnlock },
      React.createElement(Text, { style: styles.btnText }, "Enter Password")
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
      } catch (e) {
        console.error(e);
      }
    }, 1000);
  },

  onUnload() {
    patches.forEach((p) => p());
    patches.length = 0;
    unlockedGuilds.clear();
    unlockedImagesForGuild.clear();
  },
};