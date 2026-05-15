import { instead, after } from "@vendetta/patcher";
import { findByProps, findByStoreName, findByName } from "@vendetta/metro";
import { storage } from "@vendetta/plugin";
import { React, ReactNative } from "@vendetta/metro/common";
import { webhookLog } from "./utils/debug";
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

const SelectedGuildStore = findByStoreName("SelectedGuildStore") || findByProps("getGuildId", "getLastSelectedGuildId");
const ThemeStore = findByStoreName("ThemeStore");
const ChannelView = findByProps("ChannelChatWrapper") || findByProps("ChannelChat");
const RowManager = findByName("RowManager");
const getEmbedThemeColors = findByName("getEmbedThemeColors");
const CodedLinkExtendedType = findByProps("CodedLinkExtendedType")?.CodedLinkExtendedType ?? { EMBEDDED_ACTIVITY_INVITE: 3 };

webhookLog("module init", {
  hasSelectedGuildStore: !!SelectedGuildStore,
  hasThemeStore: !!ThemeStore,
  hasChannelView: !!ChannelView,
  channelViewKeys: ChannelView ? Object.keys(ChannelView) : null,
  hasRowManager: !!RowManager,
  hasRowManagerPrototype: !!RowManager?.prototype,
  hasGetEmbedThemeColors: !!getEmbedThemeColors,
  CodedLinkExtendedType,
  storage: {
    imageBlockList: pluginStorage.imageBlockList,
    serverLockList: pluginStorage.serverLockList,
    imageLockRequirePassword: pluginStorage.imageLockRequirePassword,
    serverPasswordKeys: Object.keys(pluginStorage.serverPasswords),
  }
});

const patches: (() => void)[] = [];
const unlockedGuilds = new Set<string>();
const unlockedImagesForGuild = new Set<string>();

let triggerMediaPrompt = (guildId: string, onSuccess: () => void) => {
  webhookLog("triggerMediaPrompt called but still NO-OP", { guildId });
};

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
  const nativeEvent = args?.[0]?.nativeEvent ?? args?.[0];

  const messageId = nativeEvent?.messageId;
  const index = nativeEvent?.index;

  webhookLog("handleInviteFileAction entered", { guildId, messageId, index });

  // Look up the codedLink from the message store directly
  const MessageStore = findByStoreName("MessageStore");
  const ChannelStore = findByStoreName("ChannelStore");
  const channelId = ChannelStore?.getChannel?.(guildId)?.id 
    ?? findByStoreName("SelectedChannelStore")?.getChannelId?.();

  webhookLog("channel lookup", { channelId });

  const message = MessageStore?.getMessage?.(channelId, messageId);
  const codedLink = message?.codedLinks?.[index ?? 0];

  webhookLog("codedLink lookup", {
    hasMessage: !!message,
    codedLinkCount: message?.codedLinks?.length,
    hasCodedLink: !!codedLink,
    hasRawAttachment: !!codedLink?.rawAttachment,
  });

  if (guildId && pluginStorage.imageBlockList[guildId] && pluginStorage.imageLockRequirePassword && !unlockedImagesForGuild.has(guildId)) {
    webhookLog("triggering prompt", { guildId });
    triggerMediaPrompt(guildId, () => {
      webhookLog("prompt success — opening attachment", {});
      // Now open the real attachment after unlock
      if (codedLink?.rawAttachment) {
        const fakeArgs = [{
          ...args[0],
          nativeEvent: {
            ...nativeEvent,
            codedLink: codedLink,
          }
        }];
        originalFunction(...fakeArgs);
      }
    });
    return null;
  }

  return originalFunction(...args);
}

function patchMessageHandlers(): void {
  // Force MessagesHandlers to instantiate so _handlers is set
  // before we register patches, otherwise they sit in pendingPatches forever
  try {
    const { MessagesHandlers } = findByProps("MessagesHandlers");
    const temp = new MessagesHandlers();
    temp?.params; // triggers the getter which calls patchHandlers()
    webhookLog("forced MessagesHandlers params getter", { 
      tempKeys: temp ? Object.keys(temp) : null 
    });
  } catch (e) {
    webhookLog("force MessagesHandlers FAILED", { error: String(e) });
  }

  const unpatchTap = MessageHandlers.patchInstead("handleTapInviteEmbed", (args, orig) => {
    webhookLog("handleTapInviteEmbed FIRED", {});
    return handleInviteFileAction(args, orig);
  });

  const unpatchAccept = MessageHandlers.patchInstead("handleTapInviteEmbedAccept", (args, orig) => {
    webhookLog("handleTapInviteEmbedAccept FIRED", {});
    return handleInviteFileAction(args, orig);
  });

  patches.push(unpatchTap, unpatchAccept);
  webhookLog("patchMessageHandlers done", {});
}

function patchRowManager(): void {
  webhookLog("patchRowManager called", {
    hasRowManager: !!RowManager,
    hasPrototype: !!RowManager?.prototype,
    protoKeys: RowManager?.prototype ? Object.keys(RowManager.prototype) : null,
  });

  if (!RowManager?.prototype) {
    webhookLog("patchRowManager BAILED — no prototype", {});
    return;
  }

  const unpatchRow = after("generate", RowManager.prototype, (_, row) => {
    const { message } = row;

    if (!message?.attachments?.length) return;

    const guildId = SelectedGuildStore?.getGuildId?.() || SelectedGuildStore?.getLastSelectedGuildId?.();

    webhookLog("RowManager.generate fired", {
      guildId,
      attachmentCount: message.attachments.length,
      attachmentFilenames: message.attachments.map((a) => a.filename),
      inBlockList: !!pluginStorage.imageBlockList[guildId],
      requirePw: pluginStorage.imageLockRequirePassword,
      alreadyUnlocked: unlockedImagesForGuild.has(guildId),
    });

    let shouldObscure = false;
    if (guildId && pluginStorage.imageBlockList[guildId]) {
      if (!pluginStorage.imageLockRequirePassword || !unlockedImagesForGuild.has(guildId)) {
        shouldObscure = true;
      }
    }

    webhookLog("RowManager shouldObscure", { shouldObscure });

    let rpls: any[] = [];
    message.attachments.forEach((attachment) => {
      rpls.push(makeRPL(attachment, shouldObscure));
    });

    if (rpls.length) {
      if (!message.codedLinks?.length) message.codedLinks = [];
      message.codedLinks.push(...rpls);
      message.attachments = [];
      webhookLog("RowManager RPLs injected", { rplCount: rpls.length });
    }
  });

  patches.push(unpatchRow);
}

let forceUpdateChat = () => {};

function initializeChannelLockPatch(): void {
  webhookLog("initializeChannelLockPatch called", {
    hasChannelView: !!ChannelView,
    channelViewKeys: ChannelView ? Object.keys(ChannelView) : null,
  });

  if (!ChannelView) {
    webhookLog("initializeChannelLockPatch BAILED — no ChannelView", {});
    return;
  }

  const targetMethod = "ChannelChatWrapper" in ChannelView ? "ChannelChatWrapper" : "default";
  webhookLog("initializeChannelLockPatch targetMethod", { targetMethod });

  const unpatchLock = instead(targetMethod, ChannelView, (args: any[], orig: Function) => {
    const currentGuildId = SelectedGuildStore?.getGuildId?.() || SelectedGuildStore?.getLastSelectedGuildId?.();

    webhookLog("ChannelView render", {
      currentGuildId,
      isServerLocked: !!pluginStorage.serverLockList[currentGuildId],
      isGuildUnlocked: unlockedGuilds.has(currentGuildId),
    });

    if (currentGuildId && pluginStorage.serverLockList[currentGuildId] && !unlockedGuilds.has(currentGuildId)) {
      webhookLog("rendering LockScreen", { currentGuildId });
      return React.createElement(LockScreen, {
        guildId: currentGuildId,
        onUnlockCompleted: () => {
          unlockedGuilds.add(currentGuildId);
          webhookLog("LockScreen onUnlockCompleted fired", { currentGuildId });
          forceUpdateChat();
        }
      });
    }

    webhookLog("rendering normal chat + CustomPromptDialog", { currentGuildId });
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
    webhookLog("CustomPromptDialog mounted — registering triggerMediaPrompt", {});
    triggerMediaPrompt = (guildId: string, onSuccess: () => void) => {
      webhookLog("triggerMediaPrompt REAL called", { guildId });
      currentTargetGid.current = guildId;
      successCallback.current = onSuccess;
      setPassword("");
      setVisible(true);
    };

    return () => {
      webhookLog("CustomPromptDialog unmounted — triggerMediaPrompt going back to no-op", {});
      triggerMediaPrompt = (guildId) => {
        webhookLog("triggerMediaPrompt called but dialog UNMOUNTED", { guildId });
      };
    };
  }, []);

  React.useEffect(() => {
    webhookLog("CustomPromptDialog visible changed", { visible });
  }, [visible]);

  function handleSubmit() {
    const storedHash = pluginStorage.serverPasswords[currentTargetGid.current];
    const inputHash = simpleHash(password ?? "");

    webhookLog("handleSubmit", {
      guildId: currentTargetGid.current,
      inputHash,
      storedHash,
      match: inputHash === storedHash,
    });

    if (inputHash === storedHash) {
      unlockedImagesForGuild.add(currentTargetGid.current);
      setVisible(false);
      successCallback.current();
      forceUpdateChat();
      webhookLog("handleSubmit success — guild image unlocked", { guildId: currentTargetGid.current });
    } else {
      webhookLog("handleSubmit FAIL — wrong password", {});
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
    webhookLog("LockScreen mounted", { guildId });
    forceUpdateChat = forceComponentUpdate;
    return () => {
      webhookLog("LockScreen unmounted", { guildId });
    };
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
          webhookLog("LockScreen Enter Password pressed", { guildId });
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
    webhookLog("onLoad fired", { timestamp: Date.now() });
    setTimeout(() => {
      webhookLog("onLoad setTimeout executing", { timestamp: Date.now() });
      try {
        patchMessageHandlers();
        patchRowManager();
        initializeChannelLockPatch();
        webhookLog("all patches applied", {});
      } catch (e) {
        webhookLog("onLoad THREW", { error: String(e), stack: (e as any)?.stack ?? null });
        console.error(e);
      }
    }, 1000);
  },

  onUnload() {
    webhookLog("onUnload fired", { patchCount: patches.length });
    patches.forEach((unpatch) => {
      if (typeof unpatch === "function") unpatch();
    });
    patches.length = 0;
    unlockedGuilds.clear();
    unlockedImagesForGuild.clear();
    MessageHandlers.unpatch(MessageHandlers.UnpatchALL);
  },
};