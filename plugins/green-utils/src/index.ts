import { instead, after } from "@vendetta/patcher";
import { findByProps, findByStoreName, findByName } from "@vendetta/metro";
import { storage } from "@vendetta/plugin";
import { React, ReactNative } from "@vendetta/metro/common";
import Settings from "./Settings";
import MessageHandlers from "./utils/MessageHandlersPatcher";

const { Text, View, TouchableOpacity, StyleSheet, Alert, TextInput, Modal } = ReactNative;

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

// Discord Core Stores
const SelectedGuildStore = findByStoreName("SelectedGuildStore") || findByProps("getGuildId", "getLastSelectedGuildId");
const ThemeStore = findByStoreName("ThemeStore");

// Discord Core Modules & View Components
const ChannelView = findByProps("ChannelChatWrapper") || findByProps("ChannelChat");
const RowManager = findByName("RowManager");
const getEmbedThemeColors = findByName("getEmbedThemeColors");
const CodedLinkExtendedType = findByProps("CodedLinkExtendedType")?.CodedLinkExtendedType ?? { EMBEDDED_ACTIVITY_INVITE: 3 };

const patches: (() => void)[] = [];
const unlockedGuilds = new Set<string>();
const unlockedImagesForGuild = new Set<string>();

// Dynamic trigger to invoke the custom alert overlay inside our global scope
let triggerMediaPrompt = (guildId: string, onSuccess: () => void) => {};

function simpleHash(str: string): string {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return h.toString(16);
}

function getCodedLinkColors() {
  let colors = getEmbedThemeColors?.(ThemeStore.theme)?.colors || {
    acceptLabelGreenBackgroundColor: -14385083,
    headerColor: -6973533,
    borderColor: 268435455,
    backgroundColor: -14276817,
  };
  return {
    acceptLabelBackgroundColor: colors.acceptLabelGreenBackgroundColor,
    headerColor: colors.headerColor,
    borderColor: colors.borderColor,
    backgroundColor: colors.backgroundColor,
  };
}

function makeRPL(attachment, shouldObscure: boolean) {
  const filename = attachment.filename ?? "unknown";
  const size = attachment.size ?? 0;

  const displayTitle = shouldObscure ? "⚠️ Hidden Media Asset" : "File" + " — " + size;
  const displayFilename = shouldObscure ? "Content hidden until unlocked" : "\n" + filename;
  const buttonText = shouldObscure ? "Unlock View" : "Preview";

  return {
    ...getCodedLinkColors(),
    thumbnailCornerRadius: 15,
    headerText: "",
    titleText: displayTitle,
    structurableSubtitleText: null,
    type: null,
    extendedType: CodedLinkExtendedType.EMBEDDED_ACTIVITY_INVITE,
    participantAvatarUris: [],
    acceptLabelText: buttonText,
    splashUrl: null,
    noParticipantsText: displayFilename,
    ctaEnabled: true,
    rawAttachment: attachment
  };
}

function handleInviteFileAction(args, originalFunction) {
  const guildId = SelectedGuildStore?.getGuildId?.() || SelectedGuildStore?.getLastSelectedGuildId?.();
  
  let targetEventData = args?.[0]?.nativeEvent ?? args?.[0];
  if (!targetEventData?.codedLink && args?.[1]?.codedLink) {
    targetEventData = args[1];
  }

  const executeOriginal = () => {
    if (targetEventData && targetEventData.codedLink?.rawAttachment) {
      targetEventData.message ??= {};
      targetEventData.message.attachments = [targetEventData.codedLink.rawAttachment];
    }
    return originalFunction(...args);
  };

  if (guildId && pluginStorage.imageBlockList[guildId] && pluginStorage.imageLockRequirePassword && !unlockedImagesForGuild.has(guildId)) {
    // Invoke our own custom React dialog sequence instead of Discord's native alert method
    triggerMediaPrompt(guildId, () => {
      executeOriginal();
    });
    return null;
  }

  return executeOriginal();
}

function patchMessageHandlers(): void {
  const unpatchTap = MessageHandlers.patchInstead("handleTapInviteEmbed", handleInviteFileAction);
  const unpatchAccept = MessageHandlers.patchInstead("handleTapInviteEmbedAccept", handleInviteFileAction);
  patches.push(unpatchTap, unpatchAccept);
}

function patchRowManager(): void {
  if (!RowManager?.prototype) return;
  
  const unpatchRow = after("generate", RowManager.prototype, (_, row) => {
    const { message } = row;
    if (!message?.attachments?.length) return;

    const guildId = SelectedGuildStore?.getGuildId?.() || SelectedGuildStore?.getLastSelectedGuildId?.();
    let shouldObscure = false;

    if (guildId && pluginStorage.imageBlockList[guildId]) {
      if (!pluginStorage.imageLockRequirePassword || !unlockedImagesForGuild.has(guildId)) {
        shouldObscure = true;
      }
    }

    let rpls: any[] = [];
    
    message.attachments.forEach((attachment) => {
      rpls.push(makeRPL(attachment, shouldObscure));
    });

    if (rpls.length) {
      if (!message.codedLinks?.length) message.codedLinks = [];
      message.codedLinks.push(...rpls);
      message.attachments = []; 
    }
  });
  patches.push(unpatchRow);
}

let forceUpdateChat = () => {};

// Global Layout Mount component to inject custom React dialog layers cleanly into the interface loop
function initializeChannelLockPatch(): void {
  if (!ChannelView) return;
  const targetMethod = "ChannelChatWrapper" in ChannelView ? "ChannelChatWrapper" : "default";

  const unpatchLock = instead(targetMethod, ChannelView, (args: any[], orig: Function) => {
    const currentGuildId = SelectedGuildStore?.getGuildId?.() || SelectedGuildStore?.getLastSelectedGuildId?.();

    // 1. Handle Server Lock Gateway Screen
    if (currentGuildId && pluginStorage.serverLockList[currentGuildId] && !unlockedGuilds.has(currentGuildId)) {
      return React.createElement(LockScreen, {
        guildId: currentGuildId,
        onUnlockCompleted: () => {
          unlockedGuilds.add(currentGuildId);
          forceUpdateChat();
        }
      });
    }

    // 2. Render normal layout chat viewport accompanied by our custom reactive password input dialog
    return React.createElement(
      React.Fragment,
      null,
      orig(...args),
      React.createElement(CustomPromptDialog)
    );
  });
  patches.push(unpatchLock);
}

function CustomPromptDialog() {
  const [visible, setVisible] = React.useState(false);
  const [password, setPassword] = React.useState("");
  const currentTargetGid = React.useRef<string>("");
  const successCallback = React.useRef<() => void>(() => {});

  React.useEffect(() => {
    triggerMediaPrompt = (guildId: string, onSuccess: () => void) => {
      currentTargetGid.current = guildId;
      successCallback.current = onSuccess;
      setPassword("");
      setVisible(true);
    };
  }, []);

  function handleSubmit() {
    const storedHash = pluginStorage.serverPasswords[currentTargetGid.current];
    if (simpleHash(password ?? "") === storedHash) {
      unlockedImagesForGuild.add(currentTargetGid.current);
      setVisible(false);
      successCallback.current();
      forceUpdateChat();
    } else {
      Alert.alert("Error", "Invalid Password");
    }
  }

  const styles = StyleSheet.create({
    centered:  { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "rgba(0,0,0,0.7)" },
    modalBox:  { width: "85%", backgroundColor: "#313338", borderRadius: 12, padding: 20, alignItems: "center", borderWidth: 1, borderColor: "#4e5058" },
    title:     { color: "#fff", fontSize: 18, fontWeight: "700", marginBottom: 12 },
    input:     { width: "100%", backgroundColor: "#1e1f22", color: "#dbdee1", padding: 12, borderRadius: 6, marginBottom: 20, fontSize: 16, borderStyle: "solid", borderWidth: 1, borderColor: "#4e5058" },
    row:       { flexDirection: "row", justifyContent: "flex-end", width: "100%" },
    cancelBtn: { padding: 12, marginRight: 8 },
    cancelTxt: { color: "#949ba4", fontSize: 16 },
    submitBtn: { backgroundColor: "#5865f2", paddingHorizontal: 20, paddingVertical: 12, borderRadius: 6 },
    submitTxt: { color: "#fff", fontSize: 16, fontWeight: "600" }
  });

  return React.createElement(
    Modal, { transparent: true, visible: visible, animationType: "fade", onRequestClose: () => setVisible(false) },
    React.createElement(
      View, { style: styles.centered },
      React.createElement(
        View, { style: styles.modalBox },
        React.createElement(Text, { style: styles.title }, "Images Locked"),
        React.createElement(TextInput, {
          style: styles.input,
          placeholder: "Enter password to view...",
          placeholderTextColor: "#949ba4",
          secureTextEntry: true,
          value: password,
          onChangeText: setPassword
        }),
        React.createElement(
          View, { style: styles.row },
          React.createElement(TouchableOpacity, { style: styles.cancelBtn, onPress: () => setVisible(false) }, React.createElement(Text, { style: styles.cancelTxt }, "Cancel")),
          React.createElement(TouchableOpacity, { style: styles.submitBtn, onPress: handleSubmit }, React.createElement(Text, { style: styles.submitTxt }, "Unlock"))
        )
      )
    )
  );
}

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

  return React.createElement(
    View, { style: styles.container },
    React.createElement(Text, { style: styles.icon }, "🔒"),
    React.createElement(Text, { style: styles.title }, "Server Locked"),
    React.createElement(Text, { style: styles.subtitle }, "This server is locked behind a password."),
    React.createElement(
      TouchableOpacity, {
        style: styles.btn,
        onPress: () => {
          triggerMediaPrompt(guildId, onUnlockCompleted);
        }
      },
      React.createElement(Text, { style: styles.btnText }, "Enter Password")
    )
  );
}

export default {
  settings: Settings,

  onLoad() {
    setTimeout(() => {
      try {
        patchMessageHandlers();
        patchRowManager();
        initializeChannelLockPatch();
      } catch (e) {
        console.error(e);
      }
    }, 1000);
  },

  onUnload() {
    patches.forEach((unpatch) => {
      if (typeof unpatch === "function") unpatch();
    });
    patches.length = 0;
    unlockedGuilds.clear();
    unlockedImagesForGuild.clear();
    MessageHandlers.unpatch(MessageHandlers.UnpatchALL);
  },
};