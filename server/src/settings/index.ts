/**
 * The settings slice's public surface: the settings schema and store (`schema.ts`), `GET|PUT /api/settings`
 * (`routes.ts`), `GET|PUT /api/actors` (`actors.ts`) and `GET /api/lifeos` (`lifeos-route.ts`; the detection itself is
 * `infra/lifeos.ts`), each as the router's family, its handlers and the route alone as an `ApiHandler`.
 */
export { ACTORS_FAMILY, actorsApi, actorsHandlers } from "./actors.ts";
export { LIFEOS_FAMILY, LIFEOS_PATH, lifeosApi, lifeosHandlers } from "./lifeos-route.ts";
export { SETTINGS_FAMILY, SETTINGS_PATH, settingsApi, settingsHandlers } from "./routes.ts";
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
