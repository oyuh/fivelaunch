// GTA V Settings Value Mappings
// Based on settings.xml structure and game configuration

export type SettingType = 'select' | 'toggle' | 'slider' | 'text'

export interface SettingOption {
  value: string
  label: string
}

export interface SettingDefinition {
  type: SettingType
  options?: SettingOption[]
  min?: number
  max?: number
  step?: number
  category?: string
}

// Quality levels used across multiple settings
const QUALITY_LEVELS: SettingOption[] = [
  { value: '0', label: 'Normal' },
  { value: '1', label: 'High' },
  { value: '2', label: 'Very High' },
  { value: '3', label: 'Ultra' }
]

const SIMPLE_QUALITY: SettingOption[] = [
  { value: '0', label: 'Low' },
  { value: '1', label: 'Medium' },
  { value: '2', label: 'High' }
]

const EXTENDED_QUALITY: SettingOption[] = [
  { value: '0', label: 'Very Low' },
  { value: '1', label: 'Low' },
  { value: '2', label: 'Medium' },
  { value: '3', label: 'High' },
  { value: '4', label: 'Very High' }
]

const BOOLEAN_TOGGLE: SettingOption[] = [
  { value: 'false', label: 'Disabled' },
  { value: 'true', label: 'Enabled' }
]

const MSAA_OPTIONS: SettingOption[] = [
  { value: '0', label: 'Off' },
  { value: '2', label: '2x MSAA' },
  { value: '4', label: '4x MSAA' },
  { value: '8', label: '8x MSAA' }
]

const VSYNC_OPTIONS: SettingOption[] = [
  { value: '0', label: 'Off' },
  { value: '1', label: 'On' },
  { value: '2', label: 'Half' }
]

const WINDOWED_OPTIONS: SettingOption[] = [
  { value: '0', label: 'Fullscreen' },
  { value: '1', label: 'Windowed' },
  { value: '2', label: 'Borderless' }
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

const ANISOTROPIC: SettingOption[] = [
  { value: '0', label: 'Off' },
  { value: '1', label: 'x1' },
  { value: '2', label: 'x2' },
  { value: '4', label: 'x4' },
  { value: '8', label: 'x8' },
  { value: '16', label: 'x16' }
]

const REFLECTION_MSAA: SettingOption[] = [
  { value: '0', label: 'Off' },
  { value: '2', label: 'x2' },
  { value: '4', label: 'x4' },
  { value: '8', label: 'x8' }
]

const SSAO_OPTIONS: SettingOption[] = [
  { value: '0', label: 'Off' },
  { value: '1', label: 'Normal' },
  { value: '2', label: 'High' }
]

const SHADOW_SOFT: SettingOption[] = [
  { value: '0', label: 'Softest' },
  { value: '1', label: 'Softer' },
  { value: '2', label: 'Soft' },
  { value: '3', label: 'Medium' },
  { value: '4', label: 'Sharp' },
  { value: '5', label: 'Sharper' }
]

const POSTFX_OPTIONS: SettingOption[] = [
  { value: '0', label: 'Normal' },
  { value: '1', label: 'High' },
  { value: '2', label: 'Very High' },
  { value: '3', label: 'Ultra' }
]

export const GTA_SETTINGS_MAP: Record<string, SettingDefinition> = {
  // Graphics Settings
  Tessellation: {
    type: 'select',
    options: TESSELLATION,
    category: 'Graphics Quality'
  },
  ShadowQuality: {
    type: 'select',
    options: QUALITY_LEVELS,
    category: 'Graphics Quality'
  },
  ReflectionQuality: {
    type: 'select',
    options: QUALITY_LEVELS,
    category: 'Graphics Quality'
  },
  ReflectionMSAA: {
    type: 'select',
    options: REFLECTION_MSAA,
    category: 'Graphics Quality'
  },
  SSAO: {
    type: 'select',
    options: SSAO_OPTIONS,
    category: 'Graphics Quality'
  },
  AnisotropicFiltering: {
    type: 'select',
    options: ANISOTROPIC,
    category: 'Graphics Quality'
  },
  MSAA: {
    type: 'select',
    options: MSAA_OPTIONS,
    category: 'Anti-Aliasing'
  },
  MSAAFragments: {
    type: 'select',
    options: [
      { value: '0', label: 'Off' },
      { value: '1', label: 'On' }
    ],
    category: 'Anti-Aliasing'
  },
  MSAAQuality: {
    type: 'select',
    options: SIMPLE_QUALITY,
    category: 'Anti-Aliasing'
  },
  TextureQuality: {
    type: 'select',
    options: QUALITY_LEVELS,
    category: 'Texture & Details'
  },
  ParticleQuality: {
    type: 'select',
    options: QUALITY_LEVELS,
    category: 'Effects'
  },
  WaterQuality: {
    type: 'select',
    options: QUALITY_LEVELS,
    category: 'Graphics Quality'
  },
  GrassQuality: {
    type: 'select',
    options: EXTENDED_QUALITY,
    category: 'Graphics Quality'
  },
  ShaderQuality: {
    type: 'select',
    options: QUALITY_LEVELS,
    category: 'Graphics Quality'
  },
  Shadow_SoftShadows: {
    type: 'select',
    options: SHADOW_SOFT,
    category: 'Shadows'
  },
  PostFX: {
    type: 'select',
    options: POSTFX_OPTIONS,
    category: 'Effects'
  },
  DX_Version: {
    type: 'select',
    options: DX_VERSION,
    category: 'Advanced'
  },

  // Boolean toggles
  UltraShadows_Enabled: {
    type: 'select',
    options: BOOLEAN_TOGGLE,
    category: 'Shadows'
  },
  Shadow_ParticleShadows: {
    type: 'select',
    options: BOOLEAN_TOGGLE,
    category: 'Shadows'
  },
  Shadow_LongShadows: {
    type: 'select',
    options: BOOLEAN_TOGGLE,
    category: 'Shadows'
  },
  Shadow_DisableScreenSizeCheck: {
    type: 'select',
    options: BOOLEAN_TOGGLE,
    category: 'Shadows'
  },
  Reflection_MipBlur: {
    type: 'select',
    options: BOOLEAN_TOGGLE,
    category: 'Graphics Quality'
  },
  FXAA_Enabled: {
    type: 'select',
    options: BOOLEAN_TOGGLE,
    category: 'Anti-Aliasing'
  },
  TXAA_Enabled: {
    type: 'select',
    options: BOOLEAN_TOGGLE,
    category: 'Anti-Aliasing'
  },
  Lighting_FogVolumes: {
    type: 'select',
    options: BOOLEAN_TOGGLE,
    category: 'Graphics Quality'
  },
  Shader_SSA: {
    type: 'select',
    options: BOOLEAN_TOGGLE,
    category: 'Advanced'
  },
  DoF: {
    type: 'select',
    options: BOOLEAN_TOGGLE,
    category: 'Effects'
  },
  HdStreamingInFlight: {
    type: 'select',
    options: BOOLEAN_TOGGLE,
    category: 'Performance'
  },
  TripleBuffered: {
    type: 'select',
    options: BOOLEAN_TOGGLE,
    category: 'Display'
  },
  AsyncComputeEnabled: {
    type: 'select',
    options: BOOLEAN_TOGGLE,
    category: 'Advanced'
  },

  // Sliders (0.0 - 1.0 range)
  LodScale: {
    type: 'slider',
    min: 0,
    max: 1,
    step: 0.1,
    category: 'Performance'
  },
  PedLodBias: {
    type: 'slider',
    min: 0,
    max: 1,
    step: 0.1,
    category: 'Performance'
  },
  VehicleLodBias: {
    type: 'slider',
    min: 0,
    max: 1,
    step: 0.1,
    category: 'Performance'
  },
  Shadow_Distance: {
    type: 'slider',
    min: 0,
    max: 2,
    step: 0.1,
    category: 'Shadows'
  },
  Shadow_SplitZStart: {
    type: 'slider',
    min: 0.5,
    max: 1,
    step: 0.01,
    category: 'Shadows'
  },
  Shadow_SplitZEnd: {
    type: 'slider',
    min: 0.5,
    max: 1,
    step: 0.01,
    category: 'Shadows'
  },
  Shadow_aircraftExpWeight: {
    type: 'slider',
    min: 0.9,
    max: 1,
    step: 0.01,
    category: 'Shadows'
  },
  CityDensity: {
    type: 'slider',
    min: 0,
    max: 1,
    step: 0.1,
    category: 'Population'
  },
  PedVarietyMultiplier: {
    type: 'slider',
    min: 0,
    max: 1,
    step: 0.1,
    category: 'Population'
  },
  VehicleVarietyMultiplier: {
    type: 'slider',
    min: 0,
    max: 1,
    step: 0.1,
    category: 'Population'
  },
  MaxLodScale: {
    type: 'slider',
    min: 0,
    max: 1,
    step: 0.1,
    category: 'Performance'
  },
  MotionBlurStrength: {
    type: 'slider',
    min: 0,
    max: 1,
    step: 0.1,
    category: 'Effects'
  },
  Convergence: {
    type: 'slider',
    min: 0,
    max: 1,
    step: 0.01,
    category: 'Stereoscopic 3D'
  },
  Separation: {
    type: 'slider',
    min: 0,
    max: 1,
    step: 0.01,
    category: 'Stereoscopic 3D'
  },

  // Video Settings
  VSync: {
    type: 'select',
    options: VSYNC_OPTIONS,
    category: 'Display'
  },
  Windowed: {
    type: 'select',
    options: WINDOWED_OPTIONS,
    category: 'Display'
  },
  Stereo: {
    type: 'select',
    options: BOOLEAN_TOGGLE,
    category: 'Stereoscopic 3D'
  },
  PauseOnFocusLoss: {
    type: 'select',
    options: [
      { value: '0', label: 'No' },
      { value: '1', label: 'Yes' }
    ],
    category: 'Display'
  },
  AspectRatio: {
    type: 'select',
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
  Audio3d: {
    type: 'select',
    options: BOOLEAN_TOGGLE,
    category: 'Audio'
  },

  // Sampling Mode
  SamplingMode: {
    type: 'select',
    options: [
      { value: '0', label: 'MSAA' },
      { value: '1', label: 'AMD CAS' },
      { value: '2', label: 'NVIDIA DLSS' },
      { value: '3', label: 'FSR' }
    ],
    category: 'Anti-Aliasing'
  },

  // System/Performance Settings
  numBytesPerReplayBlock: {
    type: 'text',
    category: 'Advanced'
  },
  numReplayBlocks: {
    type: 'text',
    category: 'Advanced'
  },
  maxSizeOfStreamingReplay: {
    type: 'text',
    category: 'Advanced'
  },
  maxFileStoreSize: {
    type: 'text',
    category: 'Advanced'
  },

  // Display Resolution Settings
  ScreenWidth: {
    type: 'text',
    category: 'Display'
  },
  ScreenHeight: {
    type: 'text',
    category: 'Display'
  },
  RefreshRate: {
    type: 'text',
    category: 'Display'
  },
  AdapterIndex: {
    type: 'text',
    category: 'Display'
  },
  OutputIndex: {
    type: 'text',
    category: 'Display'
  },

  // Version and Config
  version: {
    type: 'text',
    category: 'System Info'
  },
  configSource: {
    type: 'text',
    category: 'System Info'
  },
  VideoCardDescription: {
    type: 'text',
    category: 'System Info'
  }
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

// Helper to get setting definition
export function getSettingDefinition(settingName: string): SettingDefinition | null {
  return GTA_SETTINGS_MAP[settingName] || null
}

// Helper to format display value
export function getDisplayValue(settingName: string, rawValue: string): string {
  const def = getSettingDefinition(settingName)
  if (!def || !def.options) return rawValue

  const option = def.options.find(opt => opt.value === rawValue)
  return option ? option.label : rawValue
}
