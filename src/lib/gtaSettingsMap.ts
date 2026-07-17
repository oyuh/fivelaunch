// GTA V Settings Value Mappings.
// Every select maps a gta5_settings.xml value to the EXACT label the in-game
// menu shows for it (verified against real game-written files). Settings the
// menu does not expose (hidden/internal values) are left as free text.

export type SettingType = 'select' | 'toggle' | 'slider' | 'text'

export interface SettingOption {
  value: string
  label: string
}

export interface SettingDefinition {
  type: SettingType
  /** The name the in-game menu uses (falls back to the humanized XML tag). */
  label?: string
  options?: SettingOption[]
  min?: number
  max?: number
  step?: number
  category?: string
}

// Texture / shader / water / particles quality: Normal / High / Very High.
const SHORT_QUALITY: SettingOption[] = [
  { value: '0', label: 'Normal' },
  { value: '1', label: 'High' },
  { value: '2', label: 'Very High' }
]

// Grass quality: the only base quality with an Ultra step.
const GRASS_QUALITY: SettingOption[] = [
  { value: '0', label: 'Normal' },
  { value: '1', label: 'High' },
  { value: '2', label: 'Very High' },
  { value: '3', label: 'Ultra' }
]

// Shadow quality: 0 disables most shadows (not selectable in the menu, which
// only offers Normal/High/Very High — the game still accepts and keeps 0).
const SHADOW_QUALITY: SettingOption[] = [
  { value: '0', label: 'Off' },
  { value: '1', label: 'Normal' },
  { value: '2', label: 'High' },
  { value: '3', label: 'Very High' }
]

const REFLECTION_QUALITY: SettingOption[] = [
  { value: '0', label: 'Normal' },
  { value: '1', label: 'High' },
  { value: '2', label: 'Very High' },
  { value: '3', label: 'Ultra' }
]

const BOOLEAN_TOGGLE: SettingOption[] = [
  { value: 'false', label: 'Off' },
  { value: 'true', label: 'On' }
]

const MSAA_OPTIONS: SettingOption[] = [
  { value: '0', label: 'Off' },
  { value: '2', label: 'X2' },
  { value: '4', label: 'X4' },
  { value: '8', label: 'X8' }
]

const VSYNC_OPTIONS: SettingOption[] = [
  { value: '0', label: 'Off' },
  { value: '1', label: 'On' },
  { value: '2', label: 'Half' }
]

const WINDOWED_OPTIONS: SettingOption[] = [
  { value: '0', label: 'Fullscreen' },
  { value: '1', label: 'Windowed' },
  { value: '2', label: 'Windowed Borderless' }
]

const DX_VERSION: SettingOption[] = [
  { value: '0', label: 'DirectX 10' },
  { value: '1', label: 'DirectX 10.1' },
  { value: '2', label: 'DirectX 11' }
]

const TESSELLATION: SettingOption[] = [
  { value: '0', label: 'Off' },
  { value: '1', label: 'Normal' },
  { value: '2', label: 'High' },
  { value: '3', label: 'Very High' }
]

// In-game: Off / X2 / X4 / X8 / X16 (there is no x1 step).
const ANISOTROPIC: SettingOption[] = [
  { value: '0', label: 'Off' },
  { value: '2', label: 'X2' },
  { value: '4', label: 'X4' },
  { value: '8', label: 'X8' },
  { value: '16', label: 'X16' }
]

const SSAO_OPTIONS: SettingOption[] = [
  { value: '0', label: 'Off' },
  { value: '1', label: 'Normal' },
  { value: '2', label: 'High' }
]

// In-game "Soft Shadows" order: Sharp -> Softest, then the vendor techniques.
const SHADOW_SOFT: SettingOption[] = [
  { value: '0', label: 'Sharp' },
  { value: '1', label: 'Soft' },
  { value: '2', label: 'Softer' },
  { value: '3', label: 'Softest' },
  { value: '4', label: 'AMD CHS' },
  { value: '5', label: 'NVIDIA PCSS' }
]

const POSTFX_OPTIONS: SettingOption[] = [
  { value: '0', label: 'Normal' },
  { value: '1', label: 'High' },
  { value: '2', label: 'Very High' },
  { value: '3', label: 'Ultra' }
]

// "Frame Scaling Mode" in Advanced Graphics: render-resolution multiplier.
const FRAME_SCALING: SettingOption[] = [
  { value: '0', label: 'Off' },
  { value: '1', label: 'x0.500' },
  { value: '2', label: 'x0.667' },
  { value: '3', label: 'x0.750' },
  { value: '4', label: 'x0.833' },
  { value: '5', label: 'x1.000' },
  { value: '6', label: 'x1.250' },
  { value: '7', label: 'x1.500' },
  { value: '8', label: 'x2.000' }
]

export const GTA_SETTINGS_MAP: Record<string, SettingDefinition> = {
  // Graphics Settings
  Tessellation: { type: 'select', options: TESSELLATION, category: 'Graphics Quality' },
  ShadowQuality: {
    type: 'select',
    label: 'Shadow Quality',
    options: SHADOW_QUALITY,
    category: 'Graphics Quality'
  },
  ReflectionQuality: {
    type: 'select',
    label: 'Reflection Quality',
    options: REFLECTION_QUALITY,
    category: 'Graphics Quality'
  },
  ReflectionMSAA: {
    type: 'select',
    label: 'Reflection MSAA',
    options: MSAA_OPTIONS,
    category: 'Graphics Quality'
  },
  SSAO: {
    type: 'select',
    label: 'Ambient Occlusion',
    options: SSAO_OPTIONS,
    category: 'Graphics Quality'
  },
  AnisotropicFiltering: {
    type: 'select',
    label: 'Anisotropic Filtering',
    options: ANISOTROPIC,
    category: 'Graphics Quality'
  },
  MSAA: { type: 'select', label: 'MSAA', options: MSAA_OPTIONS, category: 'Anti-Aliasing' },
  TextureQuality: {
    type: 'select',
    label: 'Texture Quality',
    options: SHORT_QUALITY,
    category: 'Texture & Details'
  },
  ParticleQuality: {
    type: 'select',
    label: 'Particles Quality',
    options: SHORT_QUALITY,
    category: 'Effects'
  },
  WaterQuality: {
    type: 'select',
    label: 'Water Quality',
    options: SHORT_QUALITY,
    category: 'Graphics Quality'
  },
  GrassQuality: {
    type: 'select',
    label: 'Grass Quality',
    options: GRASS_QUALITY,
    category: 'Graphics Quality'
  },
  ShaderQuality: {
    type: 'select',
    label: 'Shader Quality',
    options: SHORT_QUALITY,
    category: 'Graphics Quality'
  },
  Shadow_SoftShadows: {
    type: 'select',
    label: 'Soft Shadows',
    options: SHADOW_SOFT,
    category: 'Shadows'
  },
  PostFX: { type: 'select', label: 'Post FX', options: POSTFX_OPTIONS, category: 'Effects' },
  DX_Version: { type: 'select', label: 'DirectX Version', options: DX_VERSION, category: 'Advanced' },
  SamplingMode: {
    type: 'select',
    label: 'Frame Scaling Mode',
    options: FRAME_SCALING,
    category: 'Anti-Aliasing'
  },

  // Boolean toggles
  UltraShadows_Enabled: {
    type: 'select',
    label: 'High Resolution Shadows',
    options: BOOLEAN_TOGGLE,
    category: 'Shadows'
  },
  Shadow_ParticleShadows: {
    type: 'select',
    label: 'Particle Shadows',
    options: BOOLEAN_TOGGLE,
    category: 'Shadows'
  },
  Shadow_LongShadows: {
    type: 'select',
    label: 'Long Shadows',
    options: BOOLEAN_TOGGLE,
    category: 'Shadows'
  },
  Shadow_DisableScreenSizeCheck: {
    type: 'select',
    options: BOOLEAN_TOGGLE,
    category: 'Shadows'
  },
  Reflection_MipBlur: { type: 'select', options: BOOLEAN_TOGGLE, category: 'Graphics Quality' },
  FXAA_Enabled: { type: 'select', label: 'FXAA', options: BOOLEAN_TOGGLE, category: 'Anti-Aliasing' },
  TXAA_Enabled: {
    type: 'select',
    label: 'NVIDIA TXAA',
    options: BOOLEAN_TOGGLE,
    category: 'Anti-Aliasing'
  },
  Lighting_FogVolumes: {
    type: 'select',
    label: 'Fog Volumes',
    options: BOOLEAN_TOGGLE,
    category: 'Graphics Quality'
  },
  Shader_SSA: { type: 'select', options: BOOLEAN_TOGGLE, category: 'Advanced' },
  DoF: {
    type: 'select',
    label: 'In-Game Depth Of Field Effects',
    options: BOOLEAN_TOGGLE,
    category: 'Effects'
  },
  HdStreamingInFlight: {
    type: 'select',
    label: 'High Detail Streaming While Flying',
    options: BOOLEAN_TOGGLE,
    category: 'Performance'
  },
  TripleBuffered: {
    type: 'select',
    label: 'Triple Buffering',
    options: BOOLEAN_TOGGLE,
    category: 'Display'
  },
  AsyncComputeEnabled: { type: 'select', options: BOOLEAN_TOGGLE, category: 'Advanced' },

  // Sliders
  LodScale: { type: 'slider', label: 'Distance Scaling', min: 0, max: 1, step: 0.1, category: 'Performance' },
  PedLodBias: { type: 'slider', min: 0, max: 1, step: 0.1, category: 'Performance' },
  VehicleLodBias: { type: 'slider', min: 0, max: 1, step: 0.1, category: 'Performance' },
  Shadow_Distance: {
    type: 'slider',
    label: 'Extended Shadows Distance',
    min: 0,
    max: 2,
    step: 0.1,
    category: 'Shadows'
  },
  Shadow_SplitZStart: { type: 'slider', min: 0.5, max: 1, step: 0.01, category: 'Shadows' },
  Shadow_SplitZEnd: { type: 'slider', min: 0.5, max: 1, step: 0.01, category: 'Shadows' },
  Shadow_aircraftExpWeight: { type: 'slider', min: 0.9, max: 1, step: 0.01, category: 'Shadows' },
  CityDensity: { type: 'slider', label: 'Population Density', min: 0, max: 1, step: 0.1, category: 'Population' },
  PedVarietyMultiplier: {
    type: 'slider',
    label: 'Population Variety (Peds)',
    min: 0,
    max: 1,
    step: 0.1,
    category: 'Population'
  },
  VehicleVarietyMultiplier: {
    type: 'slider',
    label: 'Population Variety (Vehicles)',
    min: 0,
    max: 1,
    step: 0.1,
    category: 'Population'
  },
  MaxLodScale: {
    type: 'slider',
    label: 'Extended Distance Scaling',
    min: 0,
    max: 1,
    step: 0.1,
    category: 'Performance'
  },
  MotionBlurStrength: {
    type: 'slider',
    label: 'Motion Blur Strength',
    min: 0,
    max: 1,
    step: 0.1,
    category: 'Effects'
  },
  Convergence: { type: 'slider', min: 0, max: 1, step: 0.01, category: 'Stereoscopic 3D' },
  Separation: { type: 'slider', min: 0, max: 1, step: 0.01, category: 'Stereoscopic 3D' },

  // Video Settings
  VSync: { type: 'select', label: 'VSync', options: VSYNC_OPTIONS, category: 'Display' },
  Windowed: { type: 'select', label: 'Screen Type', options: WINDOWED_OPTIONS, category: 'Display' },
  // The game writes Stereo as 0/1 (not true/false).
  Stereo: {
    type: 'select',
    label: 'Stereoscopic 3D',
    options: [
      { value: '0', label: 'Off' },
      { value: '1', label: 'On' }
    ],
    category: 'Stereoscopic 3D'
  },
  PauseOnFocusLoss: {
    type: 'select',
    label: 'Pause Game On Focus Loss',
    options: [
      { value: '0', label: 'Off' },
      { value: '1', label: 'On' }
    ],
    category: 'Display'
  },
  AspectRatio: {
    type: 'select',
    label: 'Aspect Ratio',
    options: [
      { value: '0', label: 'Auto' },
      { value: '1', label: '3:2' },
      { value: '2', label: '4:3' },
      { value: '3', label: '5:3' },
      { value: '4', label: '5:4' },
      { value: '5', label: '16:9' },
      { value: '6', label: '16:10' }
    ],
    category: 'Display'
  },

  // Audio
  Audio3d: { type: 'select', label: '3D Audio', options: BOOLEAN_TOGGLE, category: 'Audio' },

  // Hidden/internal MSAA tuning values — not exposed by the in-game menu, so
  // no invented labels: raw values only.
  MSAAFragments: { type: 'text', category: 'Advanced' },
  MSAAQuality: { type: 'text', category: 'Advanced' },

  // System/Performance Settings
  numBytesPerReplayBlock: { type: 'text', category: 'Advanced' },
  numReplayBlocks: { type: 'text', category: 'Advanced' },
  maxSizeOfStreamingReplay: { type: 'text', category: 'Advanced' },
  maxFileStoreSize: { type: 'text', category: 'Advanced' },

  // Display Resolution Settings
  ScreenWidth: { type: 'text', label: 'Resolution Width', category: 'Display' },
  ScreenHeight: { type: 'text', label: 'Resolution Height', category: 'Display' },
  RefreshRate: { type: 'text', label: 'Refresh Rate', category: 'Display' },
  AdapterIndex: { type: 'text', category: 'Display' },
  OutputIndex: { type: 'text', label: 'Output Monitor', category: 'Display' },

  // Version and Config
  version: { type: 'text', category: 'System Info' },
  configSource: { type: 'text', category: 'System Info' },
  VideoCardDescription: { type: 'text', label: 'Video Card', category: 'System Info' }
}

// Categories for grouping settings in the UI
export const SETTING_CATEGORIES = [
  'Graphics Quality',
  'Anti-Aliasing',
  'Shadows',
  'Effects',
  'Texture & Details',
  'Performance',
  'Population',
  'Display',
  'Audio',
  'Stereoscopic 3D',
  'Advanced',
  'System Info'
] as const

export type SettingCategory = (typeof SETTING_CATEGORIES)[number]

/** Plain-language help shown as a `?` tooltip next to each setting. */
export const SETTING_HELP: Record<string, string> = {
  Tessellation:
    'Adds fine geometric detail to surfaces like roads, tires, and terrain. Higher looks smoother but costs GPU.',
  ShadowQuality:
    'Resolution and detail of shadows. The in-game menu offers Normal to Very High; Off (0) disables most dynamic shadows.',
  ReflectionQuality:
    'Detail of reflections on water, glass, and shiny surfaces. One of the more demanding settings.',
  ReflectionMSAA: 'Anti-aliasing applied to reflections to reduce shimmering on reflective surfaces.',
  SSAO: 'Ambient occlusion adds soft contact shadows where objects and surfaces meet, adding depth.',
  AnisotropicFiltering:
    'Keeps textures sharp at shallow viewing angles (e.g. roads into the distance). Cheap — usually set to X16.',
  MSAA: 'Multi-sample anti-aliasing smooths jagged edges. Higher is cleaner but heavy on the GPU.',
  MSAAFragments: 'Hidden MSAA tuning value the game manages itself. Leave at 0 unless you know you need it.',
  MSAAQuality: 'Hidden MSAA tuning value the game manages itself. Leave at 0 unless you know you need it.',
  TextureQuality: 'Resolution of textures. Higher looks crisper but uses more video memory (VRAM).',
  ParticleQuality: 'Detail and count of particle effects like fire, smoke, sparks, and explosions.',
  WaterQuality: 'Detail and simulation quality of water surfaces.',
  GrassQuality:
    'Density and detail of grass and foliage. Ultra fills large areas with plants and is very demanding.',
  ShaderQuality: 'Complexity of shaders that drive lighting and surface effects.',
  Shadow_SoftShadows:
    'Shadow edge filtering: Sharp through Softest, or the vendor techniques AMD CHS / NVIDIA PCSS.',
  PostFX: 'Post-processing effects: bloom, light shafts, tone mapping, and lens effects.',
  DX_Version: 'DirectX version used to render. DirectX 11 is recommended on modern GPUs.',
  UltraShadows_Enabled: 'High Resolution Shadows (Advanced Graphics): sharper shadows near the camera, costs performance.',
  DoF: 'Depth of field blurs objects outside the focal plane for a cinematic look (needs Very High+ Post FX).',
  MotionBlurStrength: 'Amount of blur applied when the camera moves quickly. 0 disables it.',
  LodScale:
    'Distance Scaling: how far detailed models render. Higher increases draw distance (more CPU/GPU cost).',
  MaxLodScale: 'Extended Distance Scaling (Advanced Graphics): pushes detail even farther. Uses extra VRAM.',
  PedLodBias: 'How far away pedestrians keep their higher-detail models before dropping to low detail.',
  VehicleLodBias: 'How far away vehicles keep their higher-detail models before dropping to low detail.',
  CityDensity: 'Population Density: amount of traffic and pedestrians spawned in the world.',
  PedVarietyMultiplier: 'Variety of pedestrian models on screen at once.',
  VehicleVarietyMultiplier: 'Variety of vehicle models on screen at once.',
  Shadow_Distance: 'Extended Shadows Distance (Advanced Graphics): how far shadows render from the camera.',
  Shadow_LongShadows: 'Long Shadows (Advanced Graphics): accurate long shadows at sunrise/sunset.',
  VSync: 'Synchronizes the frame rate to your monitor to prevent screen tearing (can add input lag).',
  Windowed: 'Screen Type: Fullscreen (best performance), Windowed, or Windowed Borderless.',
  PauseOnFocusLoss: 'Pauses the game when you alt-tab away from it.',
  AspectRatio: 'Force a specific aspect ratio, or Auto to match your resolution.',
  SamplingMode:
    'Frame Scaling Mode (Advanced Graphics): renders at a multiple of your resolution. Below x1.000 boosts FPS; above supersamples for quality.',
  Stereo: 'Stereoscopic 3D output. Leave Off unless you use a 3D display.',
  ScreenWidth: 'Horizontal resolution in pixels.',
  ScreenHeight: 'Vertical resolution in pixels.',
  RefreshRate: 'Monitor refresh rate in Hz.',
  HdStreamingInFlight: 'Streams high-detail assets while flying. Can reduce pop-in at a performance cost.',
  TripleBuffered: 'Triple buffering can smooth frame pacing when VSync is on.'
}

export function getSettingHelp(settingName: string): string | null {
  return SETTING_HELP[settingName] ?? null
}

export function getSettingDefinition(settingName: string): SettingDefinition | null {
  return GTA_SETTINGS_MAP[settingName] || null
}

/** The name shown for a setting: the in-game menu name when known. */
export function getSettingLabel(settingName: string): string {
  return GTA_SETTINGS_MAP[settingName]?.label ?? humanizeKey(settingName)
}

export function getDisplayValue(settingName: string, rawValue: string): string {
  const def = getSettingDefinition(settingName)
  if (!def || !def.options) return rawValue
  const option = def.options.find((opt) => opt.value === rawValue)
  return option ? option.label : rawValue
}

export function humanizeKey(value: string): string {
  return value
    .replace(/_/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
}
