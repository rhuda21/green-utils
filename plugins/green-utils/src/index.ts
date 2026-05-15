import { instead } from "@vendetta/patcher";
import { findByProps, findByStoreName } from "@vendetta/metro";
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
const ChannelStore = findByStoreName("ChannelStore");

const patches: (() => void)[] = [];
const unlockedChannels = new Set<string>();

function simpleHash(str: string): string {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return h.toString(16);
}

function patchImageBlocking(): void {
  // Broad target search to avoid crashing if one doesn't exist
  const MediaComponent = 
    findByProps("renderAttachment", "renderMedia") || 
    findByProps("renderMediaAttachments") ||
    findByProps("MessageMediaAttachments") ||
    findByProps("LazyRenderMediaAttachment");

  if (!MediaComponent) {
    console.log("[ServerGuard] No media component found during lookup.");
    return;
  }

  const targetMethod = 
    "renderAttachment" in MediaComponent ? "renderAttachment" :
    "renderMedia" in MediaComponent ? "renderMedia" : "default";

  const unpatch = instead(targetMethod, MediaComponent, (args: any[], orig: Function) => {
    const guildId = GuildStore?.getLastSelectedGuildId?.();

    if (guildId && pluginStorage.imageBlockList[guildId]) {
      const attachment = args[0]?.attachment || args[0]?.item || args[0];
      const url = attachment?.url || attachment?.proxyUrl || "";

      if (attachment?.content_type?.startsWith("image") || url.match(/\.(jpg|jpeg|png|webp|gif)/i)) {
        return React.createElement(
          View,
          { style: { padding: 12, backgroundColor: "#2b2d31", borderRadius: 8, marginVertical: 4, alignItems: "center" } },
          React.createElement(Text, { style: { color: "#ed4245", fontSize: 13, fontWeight: "600" } }, "🚫 Image hidden by ServerGuard")
        );
      }
    }
    return orig(...args);
  });

  patches.push(unpatch);
}

function patchChannelLock(): void {
  const ChannelView = 
    findByProps("ChannelChatWrapper") || 
    findByProps("ChannelChat") || 
    findByProps("MessagesWrapper");

  if (!ChannelView) {
    console.log("[ServerGuard] No ChannelView component found during lookup.");
    return;
  }

  const targetMethod = 
    "ChannelChatWrapper" in ChannelView ? "ChannelChatWrapper" :
    "ChannelChat" in ChannelView ? "ChannelChat" : "default";

  const unpatch = instead(targetMethod, ChannelView, (args: any[], orig: Function) => {
    const channelId = ChannelStore?.getLastSelectedChannelId?.();

    if (channelId && pluginStorage.channelLockList[channelId] && !unlockedChannels.has(channelId)) {
      return React.createElement(LockScreen, {
        channelId,
        onUnlockCompleted: () => {
          unlockedChannels.add(channelId);
        }
      });
    }
    return orig(...args);
  });

  patches.push(unpatch);
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
    
    // Completely standalone Android/iOS safe popup prompt
    Alert.prompt(
      "Channel Locked",
      "Enter password:",
      [
        { text: "Cancel" },
        {
          text: "Unlock",
          onPress: (input?: string) => {
            if (simpleHash(input ?? "") === storedHash) {
              onUnlockCompleted();
            } else {
              Alert.alert("Error", "Invalid Password");
            }
          }
        }
      ],
      "secure-text"
    );
  }

  return React.createElement(
    View, { style: styles.container },
    React.createElement(Text, { style: styles.icon }, "🔒"),
    React.createElement(Text, { style: styles.title }, "Channel Locked"),
    React.createElement(Text, { style: styles.subtitle }, "This chat room is restricted by ServerGuard."),
    React.createElement(
      TouchableOpacity, { style: styles.btn, onPress: handleUnlock },
      React.createElement(Text, { style: styles.btnText }, "Tap to Unlock")
    )
  );
}

// ─── Plugin lifecycle ─────────────────────────────────────────
export default {
  settings: Settings,

  onLoad() {
    console.log("[ServerGuard] onLoad() baseline triggered.");
    try {
      patchImageBlocking();
      patchChannelLock();
      console.log("[ServerGuard] Patches applied cleanly.");
    } catch (error: any) {
      // Force a native alert window if it crashes internally so we can see the exact error text
      Alert.alert("ServerGuard Load Crash", String(error?.stack || error));
    }
  },

  onUnload() {
    patches.forEach((p) => p());
    patches.length = 0;
  },
};