import { useState, useEffect, useRef, useMemo } from "react";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  Volume1,
  Repeat,
  Repeat1,
  Shuffle,
  Music,
  Search,
  X,
  Flame,
  Radio,
  Clock,
  Sparkles,
} from "lucide-react";
import type { TelegramSong, PlayerState } from "../types";
import defaultSongsRaw from "../data/songs.json";

const defaultSongs: TelegramSong[] = defaultSongsRaw as TelegramSong[];

const artworkCache: Record<string, string> = {};

function formatTime(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? "0" : ""}${secs}`;
}

interface MusicPlayerProps {
  onPlayStateChange?: (isPlaying: boolean) => void;
}

export default function MusicPlayer({ onPlayStateChange }: MusicPlayerProps = {}) {
  const [songs] = useState<TelegramSong[]>(defaultSongs);
  const [searchQuery, setSearchQuery] = useState("");
  const [artworks, setArtworks] = useState<Record<string, string>>({});
  const [player, setPlayer] = useState<PlayerState>({
    currentSong: defaultSongs[0] || null,
    isPlaying: false,
    currentTime: 0,
    duration: defaultSongs[0]?.duration || 0,
    volume: 0.85,
    isMuted: false,
    repeatMode: "all",
    isShuffle: false,
    queue: defaultSongs,
    currentIndex: 0,
  });

  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    onPlayStateChange?.(player.isPlaying);
  }, [player.isPlaying, onPlayStateChange]);

  // Initialize Audio element once
  useEffect(() => {
    const audio = new Audio();
    audio.preload = "auto";
    audio.crossOrigin = "anonymous";
    audio.volume = player.volume;

    const onTimeUpdate = () => {
      setPlayer((prev) => ({
        ...prev,
        currentTime: audio.currentTime,
        duration: audio.duration || prev.duration || 0,
      }));
    };

    const onLoadedMetadata = () => {
      setPlayer((prev) => ({
        ...prev,
        duration: audio.duration || prev.duration || 0,
      }));
    };

    const onEnded = () => {
      handleNext();
    };

    const onError = (e: Event) => {
      console.warn("Audio playback error:", e);
      setPlayer((prev) => ({ ...prev, isPlaying: false }));
    };

    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("loadedmetadata", onLoadedMetadata);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);

    audioRef.current = audio;

    return () => {
      audio.pause();
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
      audio.src = "";
    };
  }, []);

  // Fetch artwork for current song
  useEffect(() => {
    const song = player.currentSong;
    if (!song) return;

    const key = `${song.artist}-${song.title}`;
    if (artworkCache[key]) {
      setArtworks((prev) => ({ ...prev, [key]: artworkCache[key] }));
      return;
    }

    const term = encodeURIComponent(`${song.artist} ${song.title}`);
    fetch(`https://itunes.apple.com/search?term=${term}&entity=song&limit=1`)
      .then((res) => res.json())
      .then((data) => {
        if (data.results && data.results.length > 0) {
          const rawUrl = data.results[0].artworkUrl100 || "";
          const highRes = rawUrl.replace("100x100bb", "600x600bb");
          artworkCache[key] = highRes;
          setArtworks((prev) => ({ ...prev, [key]: highRes }));
        }
      })
      .catch(() => {});
  }, [player.currentSong]);

  const streamUrl = useMemo(() => {
    if (!player.currentSong) return "";
    return `https://music.najjix.com/api/stream/${player.currentSong.file_id}`;
  }, [player.currentSong]);

  // Handle play/pause
  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio || !player.currentSong) return;

    if (player.isPlaying) {
      audio.pause();
      setPlayer((prev) => ({ ...prev, isPlaying: false }));
    } else {
      if (audio.src !== streamUrl) {
        audio.src = streamUrl;
      }
      audio
        .play()
        .then(() => {
          setPlayer((prev) => ({ ...prev, isPlaying: true }));
        })
        .catch((err) => {
          console.warn("Play interrupted:", err);
        });
    }
  };

  // Play a specific song
  const playSong = (song: TelegramSong, index: number) => {
    const audio = audioRef.current;
    if (!audio) return;

    const targetUrl = `https://music.najjix.com/api/stream/${song.file_id}`;
    audio.src = targetUrl;
    audio.currentTime = 0;
    audio
      .play()
      .then(() => {
        setPlayer((prev) => ({
          ...prev,
          currentSong: song,
          currentIndex: index,
          isPlaying: true,
          currentTime: 0,
          duration: song.duration || 0,
        }));
      })
      .catch((err) => {
        console.warn("Play failed:", err);
      });
  };

  const handleNext = () => {
    const q = player.queue;
    if (q.length === 0) return;

    if (player.repeatMode === "one" && audioRef.current) {
      audioRef.current.currentTime = 0;
      audioRef.current.play();
      return;
    }

    let nextIdx = player.currentIndex + 1;
    if (player.isShuffle) {
      nextIdx = Math.floor(Math.random() * q.length);
    } else if (nextIdx >= q.length) {
      if (player.repeatMode === "all") {
        nextIdx = 0;
      } else {
        setPlayer((prev) => ({ ...prev, isPlaying: false }));
        return;
      }
    }

    playSong(q[nextIdx], nextIdx);
  };

  const handlePrev = () => {
    if (audioRef.current && audioRef.current.currentTime > 3) {
      audioRef.current.currentTime = 0;
      return;
    }

    const q = player.queue;
    if (q.length === 0) return;

    let prevIdx = player.currentIndex - 1;
    if (prevIdx < 0) {
      prevIdx = q.length - 1;
    }

    playSong(q[prevIdx], prevIdx);
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    if (audioRef.current && player.duration) {
      const seekTime = (val / 100) * player.duration;
      audioRef.current.currentTime = seekTime;
      setPlayer((prev) => ({ ...prev, currentTime: seekTime }));
    }
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    if (audioRef.current) {
      audioRef.current.volume = val;
      audioRef.current.muted = val === 0;
    }
    setPlayer((prev) => ({
      ...prev,
      volume: val,
      isMuted: val === 0,
    }));
  };

  const toggleMute = () => {
    if (audioRef.current) {
      const nextMute = !player.isMuted;
      audioRef.current.muted = nextMute;
      setPlayer((prev) => ({ ...prev, isMuted: nextMute }));
    }
  };

  const toggleRepeat = () => {
    const nextMode =
      player.repeatMode === "none"
        ? "all"
        : player.repeatMode === "all"
        ? "one"
        : "none";
    setPlayer((prev) => ({ ...prev, repeatMode: nextMode }));
  };

  const toggleShuffle = () => {
    setPlayer((prev) => ({ ...prev, isShuffle: !prev.isShuffle }));
  };

  const filteredSongs = useMemo(() => {
    if (!searchQuery.trim()) return songs;
    const q = searchQuery.toLowerCase();
    return songs.filter(
      (s) =>
        s.title.toLowerCase().includes(q) || s.artist.toLowerCase().includes(q)
    );
  }, [songs, searchQuery]);

  const currentKey = player.currentSong
    ? `${player.currentSong.artist}-${player.currentSong.title}`
    : "";
  const currentArtwork = artworks[currentKey] || null;

  const progressPercent = player.duration
    ? (player.currentTime / player.duration) * 100
    : 0;

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden select-none">
      {/* Top Now Playing Hero Card */}
      <div className="p-3 border-b border-white/[0.08] bg-white/[0.02]">
        <div className="flex items-center space-x-3">
          {/* Glowing Album Art */}
          <div className="relative w-16 h-16 shrink-0 rounded-xl overflow-hidden bg-black/40 border border-white/10 shadow-lg group">
            {currentArtwork ? (
              <img
                src={currentArtwork}
                alt={player.currentSong?.title}
                className="w-full h-full object-cover pointer-events-none"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-gradient-to-tr from-purple-900/60 to-blue-900/60 text-white/50">
                <Music className="w-7 h-7" />
              </div>
            )}

            {/* Pulsing Audio Visualizer Overlay */}
            {player.isPlaying && (
              <div className="absolute inset-0 bg-black/40 flex items-center justify-center space-x-0.5 pointer-events-none">
                <span className="w-1 bg-green-400 rounded-full animate-bounce [animation-delay:0.1s] h-4" />
                <span className="w-1 bg-green-400 rounded-full animate-bounce [animation-delay:0.3s] h-7" />
                <span className="w-1 bg-green-400 rounded-full animate-bounce [animation-delay:0.2s] h-5" />
                <span className="w-1 bg-green-400 rounded-full animate-bounce [animation-delay:0.4s] h-6" />
              </div>
            )}
          </div>

          {/* Song Metadata */}
          <div className="min-w-0 flex-1">
            <div className="flex items-center space-x-1 mb-0.5">
              <Radio className="w-3 h-3 text-emerald-400 animate-pulse" />
              <span className="text-[9.5px] uppercase font-bold tracking-wider text-emerald-400">
                Telegram Stream
              </span>
            </div>
            <h3 className="text-xs font-semibold text-white/95 truncate">
              {player.currentSong?.title || "No Track Selected"}
            </h3>
            <p className="text-[11px] text-white/60 truncate">
              {player.currentSong?.artist || "Telegram Music Cloud"}
            </p>
          </div>
        </div>

        {/* Progress Scrubber */}
        <div className="mt-2.5">
          <input
            type="range"
            min="0"
            max="100"
            step="0.1"
            value={progressPercent || 0}
            onChange={handleSeek}
            className="w-full accent-blue-500 cursor-pointer h-1 bg-white/10 rounded-lg outline-none"
          />
          <div className="flex justify-between items-center text-[9.5px] text-white/40 mt-1 font-mono">
            <span>{formatTime(player.currentTime)}</span>
            <span>{formatTime(player.duration)}</span>
          </div>
        </div>

        {/* Transport Controls */}
        <div className="flex items-center justify-between mt-2 pt-1 border-t border-white/[0.06]">
          {/* Shuffle Toggle */}
          <button
            onClick={toggleShuffle}
            title={player.isShuffle ? "Shuffle On" : "Shuffle Off"}
            className={`p-1.5 rounded-md transition-colors ${
              player.isShuffle
                ? "text-blue-400 bg-blue-500/20"
                : "text-white/40 hover:text-white"
            }`}
          >
            <Shuffle className="w-3.5 h-3.5" />
          </button>

          {/* Playback Controls */}
          <div className="flex items-center space-x-2">
            <button
              onClick={handlePrev}
              title="Previous Track"
              className="p-1.5 rounded-full hover:bg-white/10 text-white/75 hover:text-white transition-colors"
            >
              <SkipBack className="w-4 h-4 fill-current" />
            </button>

            <button
              onClick={togglePlay}
              title={player.isPlaying ? "Pause" : "Play"}
              className="w-8 h-8 rounded-full bg-white text-black flex items-center justify-center hover:scale-105 active:scale-95 shadow-md transition-all"
            >
              {player.isPlaying ? (
                <Pause className="w-4 h-4 fill-current text-black" />
              ) : (
                <Play className="w-4 h-4 fill-current text-black ml-0.5" />
              )}
            </button>

            <button
              onClick={handleNext}
              title="Next Track"
              className="p-1.5 rounded-full hover:bg-white/10 text-white/75 hover:text-white transition-colors"
            >
              <SkipForward className="w-4 h-4 fill-current" />
            </button>
          </div>

          {/* Repeat Mode Toggle */}
          <button
            onClick={toggleRepeat}
            title={`Repeat: ${player.repeatMode}`}
            className={`p-1.5 rounded-md transition-colors ${
              player.repeatMode !== "none"
                ? "text-blue-400 bg-blue-500/20"
                : "text-white/40 hover:text-white"
            }`}
          >
            {player.repeatMode === "one" ? (
              <Repeat1 className="w-3.5 h-3.5" />
            ) : (
              <Repeat className="w-3.5 h-3.5" />
            )}
          </button>

          {/* Volume Control */}
          <div className="flex items-center space-x-1.5 ml-1">
            <button
              onClick={toggleMute}
              className="text-white/40 hover:text-white transition-colors"
            >
              {player.isMuted || player.volume === 0 ? (
                <VolumeX className="w-3.5 h-3.5 text-red-400" />
              ) : player.volume < 0.5 ? (
                <Volume1 className="w-3.5 h-3.5" />
              ) : (
                <Volume2 className="w-3.5 h-3.5" />
              )}
            </button>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={player.isMuted ? 0 : player.volume}
              onChange={handleVolumeChange}
              className="w-14 accent-blue-500 cursor-pointer h-1 bg-white/10 rounded-lg outline-none"
            />
          </div>
        </div>
      </div>

      {/* Track Search Bar */}
      <div className="px-3 pt-2 pb-1.5">
        <div className="relative flex items-center">
          <Search className="w-3.5 h-3.5 absolute left-2.5 text-white/40 pointer-events-none" />
          <input
            type="text"
            placeholder="Search 360+ Telegram tracks..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-black/25 hover:bg-black/35 focus:bg-black/45 border border-white/10 focus:border-blue-400/50 rounded-xl pl-8 pr-7 py-1 text-[11px] text-white placeholder-white/35 outline-none transition-all shadow-inner"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-2 text-white/40 hover:text-white"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* Track List */}
      <div className="flex-1 overflow-y-auto px-2 space-y-0.5 pb-2">
        <div className="px-2 py-1 flex items-center justify-between text-[10px] uppercase font-bold tracking-wider text-white/40">
          <span className="flex items-center space-x-1">
            <Flame className="w-3 h-3 text-amber-400" />
            <span>Telegram Music Cloud ({filteredSongs.length})</span>
          </span>
          <span className="text-white/30 text-[9px] font-mono">360 Streams</span>
        </div>

        {filteredSongs.map((song, idx) => {
          const isCurrent = player.currentSong?.file_id === song.file_id;
          return (
            <div
              key={song.file_id}
              onClick={() => playSong(song, idx)}
              className={`macos-item-row group flex items-center justify-between px-2.5 py-1.5 rounded-lg cursor-pointer transition-colors ${
                isCurrent
                  ? "bg-blue-600/30 border border-blue-400/40"
                  : "hover:bg-white/[0.08]"
              }`}
            >
              <div className="flex items-center space-x-2.5 min-w-0 flex-1">
                {/* Index / Audio Wave icon */}
                <div className="w-6 h-6 shrink-0 flex items-center justify-center rounded-md bg-white/[0.05] text-[10px] font-mono text-white/50">
                  {isCurrent && player.isPlaying ? (
                    <span className="w-2 h-2 rounded-full bg-green-400 animate-ping" />
                  ) : (
                    <Music className="w-3 h-3 text-white/40 group-hover:text-white" />
                  )}
                </div>

                {/* Track Details */}
                <div className="min-w-0 flex-1 text-left">
                  <h4
                    className={`text-[11.5px] font-medium truncate ${
                      isCurrent ? "text-blue-300 font-semibold" : "text-white/85 group-hover:text-white"
                    }`}
                  >
                    {song.title}
                  </h4>
                  <p className="text-[10px] text-white/50 truncate">
                    {song.artist}
                  </p>
                </div>
              </div>

              {/* Duration & Play Action */}
              <div className="flex items-center space-x-2 shrink-0 ml-1.5">
                {song.duration && (
                  <span className="text-[9.5px] font-mono text-white/40 flex items-center space-x-0.5">
                    <Clock className="w-2.5 h-2.5 opacity-60 mr-0.5" />
                    <span>{formatTime(song.duration)}</span>
                  </span>
                )}
                <div className="w-5 h-5 rounded-md bg-white/10 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white/70 hover:text-white hover:bg-white/20 transition-opacity">
                  <Play className="w-2.5 h-2.5 fill-current ml-0.5" />
                </div>
              </div>
            </div>
          );
        })}

        {filteredSongs.length === 0 && (
          <div className="text-center py-8 text-white/40 text-[11px]">
            No songs matching "{searchQuery}"
          </div>
        )}
      </div>

      {/* Cloud Status Footer */}
      <div className="px-3 py-1.5 border-t border-white/[0.08] bg-black/20 flex items-center justify-between text-[10px] text-white/40">
        <span className="flex items-center space-x-1">
          <Sparkles className="w-3 h-3 text-purple-400" />
          <span>music.najjix.com connected</span>
        </span>
        <span className="font-mono text-emerald-400">CDN Ready</span>
      </div>
    </div>
  );
}
