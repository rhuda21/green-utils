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

// Locate Discord's central layout rows processing manager
const RowManager = findByProps("generateRows") || findByName("RowManager") || findByProps("updateRows");

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
  // 1. Hook RowManager to strip out/spoil media details right before they render to the UI list
  if (RowManager) {
    const targetMethod = RowManager.generateRows ? "generateRows" : "updateRows";
    if (typeof RowManager[targetMethod] === "function") {
      const unpatchRows = before(targetMethod, RowManager, (args: any[]) => {
        const guildId = SelectedGuildStore?.getGuildId?.() || SelectedGuildStore?.getLastSelectedGuildId?.();
        if (!guildId || !pluginStorage.imageBlockList[guildId]) return;

        // If password control is mandatory and currently locked
        if (pluginStorage.imageLockRequirePassword && !unlockedImagesForGuild.has(guildId)) {
          const rows = args[0];
          if (Array.isArray(rows)) {
            for (const row of rows) {
              if (row?.message) {
                row.inlineEmbedMedia = false;
                row.shouldObscureSpoiler = true;
                
                if (row.message.attachments) {
                  for (const att of row.message.attachments) {
                    att.spoiler = true;
                  }
                }
                if (row.message.embeds) {
                  for (const emb of row.message.embeds) {
                    emb.type = "link";
                    delete emb.image;
                    delete emb.video;
                    delete emb.thumbnail;
                  }
                }
              }
            }
          }
        }
      });
      patches.push(unpatchRows);
    }
  }

  // 2. Wrap image viewer entry items completely to catch attachment interactions
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