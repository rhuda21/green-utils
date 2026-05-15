import { instead } from "@vendetta/patcher";
import { findByProps, findByStoreName } from "@vendetta/metro";
import { storage } from "@vendetta/plugin";
import { React, ReactNative } from "@vendetta/metro/common";
import Settings from "./Settings";

const { Text, View, TouchableOpacity, StyleSheet, Alert } = ReactNative;

// ─── Define Type Interfaces ───────────────────────────────────
interface PluginStorage {
  imageBlockList: Record<string, boolean>;
  channelPasswords: Record<string, string>;
  channelLockList: Record<string, boolean>;
}

// Cast storage to our typed interface safely
const pluginStorage = storage as unknown as PluginStorage;

// ─── Storage defaults ─────────────────────────────────────────
pluginStorage.imageBlockList   ??= {};
pluginStorage.channelPasswords ??= {};
pluginStorage.channelLockList  ??= {};

// ─── Module lookups ──────────────────────────────────────────
const GuildStore = findByStoreName("GuildStore");
const ChannelStore = findByStoreName("ChannelStore");

// Multi-fallback lookup for media rendering components
const MediaComponent = 
  findByProps("renderAttachment", "renderMedia") || 
  findByProps("renderMediaAttachments") ||
  findByProps("MessageMediaAttachments");

const ChannelView = findByProps("ChannelChatWrapper") || findByProps("ChannelChat");

const patches: (() => void)[] = [];
const unlockedChannels = new Set<string>();

/**
 * Very lightweight "hash" – must match Settings file
 */
function simpleHash(str: string): string {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return h.toString(16);
}

// ─── Feature 1: Image blocking per-server ────────────────────
function patchImageBlocking(): void {
  if (!MediaComponent) {
    console.warn("[ServerGuard] MediaComponent not found, skipping image blocking patch.");
    return;
  }

  // Determine method name dynamically based on fallback matches
  const targetMethod = 
    "renderAttachment" in MediaComponent ? "renderAttachment" :
    "renderMedia" in MediaComponent ? "renderMedia" : "default";

  const unpatch = instead(targetMethod, MediaComponent, (args: any[], orig: Function) => {
    const guildId = GuildStore?.getLastSelectedGuildId?.();

    if (guildId && pluginStorage.imageBlockList[guildId]) {
      // Pull image target out of variant argument definitions safely
      const attachment = args[0]?.attachment || args[0]?.item || args[0];
      const url = attachment?.url || attachment?.proxyUrl || "";

      if (
        attachment?.content_type?.startsWith("image") || 
        url.match(/\.(jpg|jpeg|png|webp|gif)/i)
      ) {
        return React.createElement(
          View,
          { style: { padding: 12, backgroundColor: "#2b2d31", borderRadius: 8, marginVertical: 4, alignItems: "center" } },
          React.createElement(Text, { style: { color: "#80848e", fontSize: 13, fontWeight: "600" } }, "🚫 Image hidden by ServerGuard")
        );
      }
    }

    return orig(...args);
  });

  patches.push(unpatch);
}

// ─── Feature 2: Password-protected channels ───────────────────
async function promptForPassword(channelId: string): Promise<boolean> {
  const storedHash = pluginStorage.channelPasswords[channelId];

  return new Promise((resolve) => {
    // Check if device supports prompt (iOS only natively)
    if (typeof Alert.prompt === "function") {
      Alert.prompt(
        "Channel locked",
        "Enter the password to view this channel.",
        [
          { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
          {
            text: "Unlock",
            onPress: (input?: string) => {
              if (simpleHash(input ?? "") === storedHash) {
                unlockedChannels.add(channelId);
                resolve(true);
              } else {
                Alert.alert("Error", "Incorrect password");
                resolve(false);
              }
            },
          },
        ],
        "secure-text"
      );
    } else {
      // Android Fallback: Use the native input modal helper provided by client UI layer if present,
      // or redirect users to use their profile dashboard to temporarily lift rules.
      // For core stability, fallback loops use standard dialog confirmation:
      try {
        const { showInputAlert } = require("@vendetta/ui/alerts") || {};
        if (showInputAlert) {
          showInputAlert({
            title: "Channel locked",
            placeholder: "Enter password",
            secureTextEntry: true,
          }).then((input: string) => {
            if (simpleHash(input ?? "") === storedHash) {
              unlockedChannels.add(channelId);
              resolve(true);
            } else {
              resolve(false);
            }
          });
          return;
        }
      } catch {}

      // Absolute baseline fallback alert if UI helpers are missing
      Alert.alert(
        "Android Protection", 
        "To unlock channels on Android devices, please use the ServerGuard section in your Profile Settings to manage locks.",
        [{ text: "OK", onPress: () => resolve(false) }]
      );
    }
  });
}

/**
 * Stateful Controller Component (TypeScript)
 * Manages local re-renders to swap lock screens natively.
 */
function ChannelLockController({ channelId, origArgs, originalComponent }: any) {
  const [isUnlocked, setIsUnlocked] = React.useState<boolean>(unlockedChannels.has(channelId));
  const isLockEnabled = pluginStorage.channelLockList[channelId];

  // Force strict synchronization state check
  React.useEffect(() => {
    setIsUnlocked(unlockedChannels.has(channelId));
  }, [channelId]);

  if (isLockEnabled && !isUnlocked) {
    return React.createElement(LockScreen, {
      channelId,
      onUnlockCompleted: () => setIsUnlocked(true)
    });
  }

  return originalComponent(...origArgs);
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

  async function handleUnlock() {
    const ok = await promptForPassword(channelId);
    if (ok) onUnlockCompleted();
  }

  return React.createElement(
    View, { style: styles.container },
    React.createElement(Text, { style: styles.icon }, "🔒"),
    React.createElement(Text, { style: styles.title }, "Channel locked"),
    React.createElement(Text, { style: styles.subtitle }, "This chat room is restricted behind a ServerGuard security filter."),
    React.createElement(
      TouchableOpacity, { style: styles.btn, onPress: handleUnlock },
      React.createElement(Text, { style: styles.btnText }, "Tap to Unlock")
    )
  );
}

function patchChannelLock(): void {
  if (!ChannelView) {
    console.warn("[ServerGuard] ChannelView module not found, skipping channel lock patch.");
    return;
  }

  const targetMethod = findByProps("ChannelChatWrapper") ? "ChannelChatWrapper" : "default";

  try {
    const unpatch = instead(targetMethod, ChannelView, (args: any[], orig: Function) => {
      const channelId = ChannelStore?.getLastSelectedChannelId?.();

      if (channelId && pluginStorage.channelLockList[channelId]) {
        return React.createElement(ChannelLockController, {
          channelId,
          origArgs: args,
          originalComponent: orig
        });
      }

      return orig(...args);
    });

    patches.push(unpatch);
  } catch (err) {
    console.error("[ServerGuard] Failed to patch ChannelView:", err);
  }
}

// ─── Plugin lifecycle ─────────────────────────────────────────
export default {
  settings: Settings,

  onLoad() {
    patchImageBlocking();
    patchChannelLock();
  },

  onUnload() {
    patches.forEach((p) => p());
    patches.length = 0;
  },
};