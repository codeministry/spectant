/**
 * The settings slice's public surface: the settings schema and store (`schema.ts`), `GET|PUT /api/settings`
 * (`routes.ts`), `GET|PUT /api/actors` (`actors.ts`) and `GET /api/lifeos` (`lifeos-route.ts`; the detection itself is
 * `infra/lifeos.ts`).
 */
export { actorsApi } from "./actors.ts";
export { LIFEOS_PATH, lifeosApi } from "./lifeos-route.ts";
export { SETTINGS_PATH, settingsApi } from "./routes.ts";
export {
  DEFAULT_SETTINGS,
  type SettingKey,
  type Settings,
  SettingsError,
  type SettingsErrorCode,
  SettingsSchema,
  type SettingSpec,
  type SettingsStore,
  openSettings,
} from "./schema.ts";
