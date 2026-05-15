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
    unlockedGuilds.add(guildId);
    callback();
    return;
  }

  const customAlert = alertModule?.showInputAlert;
  if (customAlert) {
    customAlert({
      title: "Images Locked",
      placeholder: "Enter password...",
      secureTextEntry: true,
      confirmText: "Unlock",
      cancelText: "Cancel",
      onConfirm: (input: string) => {
        if (simpleHash(input ?? "") === storedHash) {
          unlockedGuilds.add(guildId);
          callback();
        } else {
          Alert.alert("Error", "Invalid Password");
        }
      }
    });
  } else {
    Alert.alert("Unlock Required", "Please enter password through settings panel.");
  }
}

function patchImageBlocking(): void {
  const createMessageContent = findByName("createMessageContent", false);
  if (!createMessageContent) return;

  const unpatch = before("default", createMessageContent, (args: any[]) => {
    const content = args[0];
    if (!content?.message || !content?.options) return;

    const guildId = SelectedGuildStore?.getGuildId?.() || SelectedGuildStore?.getLastSelectedGuildId?.();
    if (!guildId) return;

    if (pluginStorage.imageBlockList[guildId]) {
      if (pluginStorage.imageLockRequirePassword && !unlockedGuilds.has(guildId)) {
        content.options.inlineEmbedMedia = false;
        content.options.shouldObscureSpoiler = true;

        if (content.message.attachments?.length) {
          for (const attachment of content.message.attachments) {
            attachment.spoiler = true;
          }
        }

        if (content.message.embeds?.length) {
          for (const embed of content.message.embeds) {
            embed.type = "link";
            delete embed.image;
            delete embed.video;
            delete embed.thumbnail;
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
  patches.push(unpatch);

  const MediaViewerModule = findByProps("openMediaViewer", "showMediaViewer");
  if (MediaViewerModule) {
    const targetMethod = MediaViewerModule.openMediaViewer ? "openMediaViewer" : "showMediaViewer";
    const unpatchMedia = instead(targetMethod, MediaViewerModule, function(args, orig) {
      const guildId = SelectedGuildStore?.getGuildId?.() || SelectedGuildStore?.getLastSelectedGuildId?.();
      if (guildId && pluginStorage.imageBlockList[guildId] && pluginStorage.imageLockRequirePassword && !unlockedGuilds.has(guildId)) {
        triggerImageUnlockPopup(guildId, () => orig.apply(this, args));
        return;
      }
      return orig.apply(this, args);
    });
    patches.push(unpatchMedia);
  }
}

function initializeChannelLockPatch(): void {
  if (!ChannelView) return;
  const targetMethod = "ChannelChatWrapper" in ChannelView ? "ChannelChatWrapper" : "default";

  const unpatch = instead(targetMethod, ChannelView, (args: any[], orig: Function) => {
    // Continuous dynamic lookup hook inside the live render cycle execution block
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

    // Pass cleanly back down to original UI renderer layout if clear or verified
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
  },
};