export interface AppItem {
  id: string;
  name: string;
  path: string;
  icon_base64?: string;
  args?: string;
  category_id: string;
}

export interface AppGroup {
  id: string;
  name: string;
  color: string;
  is_collapsed: boolean;
  items: AppItem[];
}

export interface SidebarSettings {
  dock_edge: string; // "right" | "left"
  width: number;
  is_appbar: boolean;
  always_on_top: boolean;
  auto_hide: boolean;
}

export interface AppConfig {
  settings: SidebarSettings;
  groups: AppGroup[];
}

export interface TelegramSong {
  file_id: string;
  file_unique_id: string;
  title: string;
  artist: string;
  album?: string | null;
  duration?: number | null;
  play_count?: number | null;
  artwork_url?: string;
}

export interface PlayerState {
  currentSong: TelegramSong | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  isMuted: boolean;
  repeatMode: 'none' | 'all' | 'one';
  isShuffle: boolean;
  queue: TelegramSong[];
  currentIndex: number;
}

export interface MarketAsset {
  id: string;
  symbol: string;
  name: string;
  label: string;
  price: number;
  change24h: number;
  high24h?: number;
  low24h?: number;
  volume24h?: number;
  lastUpdated?: number;
  iconType: 'btc' | 'eth' | 'gold' | 'ton';
}

export interface ModelQuotaInfo {
  id: string;
  display_name: string;
  percentage: number;
  reset_time: string | null;
}

export interface GoogleAccountQuota {
  id: string;
  email: string;
  subscription_tier: 'PRO' | 'ULTRA' | 'FREE';
  is_active: boolean;
  models: ModelQuotaInfo[];
  last_updated: number;
}
