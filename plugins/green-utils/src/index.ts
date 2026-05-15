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

interface Attachment {
  content_type?: string;
  [key: string]: any;
}

interface RenderAttachmentArgs {
  attachment: Attachment;
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
const MediaComponent = findByProps("renderAttachment", "renderMedia");
const ChannelView = findByProps("ChannelChatWrapper") || findByProps("ChannelChat");

const patches: (() => void)[] = [];
const unlockedChannels = new Set<string>();

/**
 * Very lightweight "hash" – just so we aren't storing plaintext.
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

  const unpatch = instead("renderAttachment", MediaComponent, (args: [RenderAttachmentArgs], orig: Function) => {
    const { attachment } = args[0] ?? {};
    const guildId = GuildStore?.getLastSelectedGuildId?.();

    if (
      guildId &&
      pluginStorage.imageBlockList[guildId] &&
      attachment?.content_type?.startsWith("image")
    ) {
      return React.createElement(
        View,
        { style: { padding: 8, backgroundColor: "#2b2d31", borderRadius: 4 } },
        React.createElement(Text, { style: { color: "#80848e", fontSize: 12 } }, "🚫 Image hidden by ServerGuard")
      );
    }

    return orig(...args);
  });

  patches.push(unpatch);
}

// ─── Feature 2: Password-protected channels ───────────────────
async function promptForPassword(channelId: string): Promise<boolean> {
  const storedHash = pluginStorage.channelPasswords[channelId];

  return new Promise((resolve) => {
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
              resolve(false);
            }
          },
        },
      ],
      "secure-text"
    );
  });
}

/**
 * Stateful Controller Component (TypeScript)
 * Manages local re-renders to swap lock screens natively.
 */
function ChannelLockController({ channelId, origArgs, originalComponent }: any) {
  const [isUnlocked, setIsUnlocked] = React.useState<boolean>(unlockedChannels.has(channelId));
  const isLockEnabled = pluginStorage.channelLockList[channelId];

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
    container: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#313338" },
    icon:      { fontSize: 48, marginBottom: 12 },
    title:     { color: "#f2f3f5", fontSize: 18, fontWeight: "600", marginBottom: 8 },
    subtitle:  { color: "#80848e", fontSize: 14, marginBottom: 24 },
    btn:       { backgroundColor: "#5865f2", paddingHorizontal: 24, paddingVertical: 12, borderRadius: 8 },
    btnText:   { color: "#fff", fontSize: 15, fontWeight: "600" },
  });

  async function handleUnlock() {
    const ok = await promptForPassword(channelId);
    if (ok) onUnlockCompleted();
  }

  return React.createElement(
    View, { style: styles.container },
    React.createElement(Text, { style: styles.icon }, "🔒"),
    React.createElement(Text, { style: styles.title }, "Channel locked"),
    React.createElement(Text, { style: styles.subtitle }, "This channel is protected by ServerGuard."),
    React.createElement(
      TouchableOpacity, { style: styles.btn, onPress: handleUnlock },
      React.createElement(Text, { style: styles.btnText }, "Unlock")
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