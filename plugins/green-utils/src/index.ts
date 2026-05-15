import { findByProps } from "@vendetta/metro";
import { ReactNative } from "@vendetta/metro/common";
import Settings from "./Settings";

const { Alert } = ReactNative;

function runMetroModuleDump(): void {
  try {
    const targets = {
      ContextMenu: findByProps("openContextMenu") || findByProps("showContextMenu"),
      ActionSheet: findByProps("openActionSheet") || findByProps("hideActionSheet") || findByProps("showActionSheet"),
      ModalSheet: findByProps("openModalLazy") || findByProps("presentModal"),
      ComponentSheet: findByProps("showBottomSheet") || findByProps("openBottomSheet")
    };

    const dumpResults: string[] = [];

    for (const [category, moduleInstance] of Object.entries(targets)) {
      if (!moduleInstance) {
        dumpResults.push(`${category}: [Not Found]`);
        continue;
      }

      const methodKeys = Object.keys(moduleInstance).filter(
        (key) => typeof (moduleInstance as any)[key] === "function"
      );

      dumpResults.push(`${category}: [${methodKeys.join(", ")}]`);
    }

    Alert.alert(
      "greenUtils Deep Diagnostics Dump",
      dumpResults.join("\n\n"),
      [{ text: "Close Report" }]
    );

    console.log("=== greenUtils DISCOVERY METHOD DUMP ===");
    console.log(JSON.stringify(dumpResults, null, 2));

  } catch (error) {
    console.error("[greenUtils] Dump execution failure: ", error);
    Alert.alert("Dump Error", String(error));
  }
}

export default {
  settings: Settings,

  onLoad() {
    setTimeout(() => {
      runMetroModuleDump();
    }, 2000);
  },

  onUnload() {}
};