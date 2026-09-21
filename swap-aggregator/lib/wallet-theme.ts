import type { Theme } from "@rainbow-me/rainbowkit";

/** Keep wallet dialogs in the same palette without importing optional connectors. */
export const hermesWalletTheme: Theme = {
  blurs: { modalOverlay: "blur(8px)" },
  fonts: { body: "Inter, system-ui, sans-serif" },
  radii: { actionButton: "14px", connectButton: "999px", menuButton: "14px", modal: "24px", modalMobile: "24px" },
  shadows: { connectButton: "none", dialog: "0 24px 80px #0006", profileDetailsAction: "none", selectedOption: "0 0 0 1px #b99add", selectedWallet: "0 0 0 1px #b99add", walletLogo: "none" },
  colors: {
    accentColor: "#653ca2", accentColorForeground: "#fcfaff", actionButtonBorder: "#463155", actionButtonBorderMobile: "#463155",
    actionButtonSecondaryBackground: "#291838", closeButton: "#c9b5df", closeButtonBackground: "#342144",
    connectButtonBackground: "#653ca2", connectButtonBackgroundError: "#703545", connectButtonInnerBackground: "#291838",
    connectButtonText: "#fcfaff", connectButtonTextError: "#fcfaff", connectionIndicator: "#9de1bb",
    downloadBottomCardBackground: "#291838", downloadTopCardBackground: "#342144", error: "#ffabb9",
    generalBorder: "#463155", generalBorderDim: "#342144", menuItemBackground: "#342144",
    modalBackdrop: "#120b1ebd", modalBackground: "#1d102e", modalBorder: "#463155",
    modalText: "#fcfaff", modalTextDim: "#bca6d2", modalTextSecondary: "#d7c7e7",
    profileAction: "#291838", profileActionHover: "#342144", profileForeground: "#1d102e",
    selectedOptionBorder: "#a579da", standby: "#eed099",
  },
};
