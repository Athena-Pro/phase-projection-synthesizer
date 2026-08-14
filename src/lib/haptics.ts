import { Haptics, ImpactStyle } from '@capacitor/haptics';

export const haptics = {
  impactLight: async () => {
    try {
      await Haptics.impact({ style: ImpactStyle.Light });
    } catch (e) {
      // Ignore if not supported (e.g. on web)
    }
  },
  impactMedium: async () => {
    try {
      await Haptics.impact({ style: ImpactStyle.Medium });
    } catch (e) {
      // Ignore if not supported
    }
  },
  impactHeavy: async () => {
    try {
      await Haptics.impact({ style: ImpactStyle.Heavy });
    } catch (e) {
      // Ignore if not supported
    }
  },
};
