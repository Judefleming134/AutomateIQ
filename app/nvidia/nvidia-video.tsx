"use client";

import { useRef, useState } from "react";
import { Play } from "lucide-react";

/**
 * The phone's screen video. Prefers a self-hosted MP4 (clean, full-bleed, no
 * third-party chrome) at /nvidia-reel.mp4 with an optional poster at
 * /nvidia-poster.jpg. If that file isn't present yet, it falls back to the
 * Instagram embed so the page is never broken. No autoplay — the visitor
 * presses play.
 */
export function NvidiaVideo() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [fallback, setFallback] = useState(false);
  const [playing, setPlaying] = useState(false);

  if (fallback) {
    return (
      <iframe
        className="nv-embed"
        src="https://www.instagram.com/reel/DZ7y_MiiqI3/embed"
        title="NVIDIA's Vision — Instagram reel"
        loading="lazy"
        allow="encrypted-media; picture-in-picture; web-share"
        allowFullScreen
        scrolling="no"
      />
    );
  }

  return (
    <div className="nv-video-wrap">
      <video
        ref={videoRef}
        className="nv-video"
        poster="/nvidia-poster.jpg"
        playsInline
        controls={playing}
        preload="metadata"
        onError={() => setFallback(true)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
      >
        {/* Prefers a self-hosted file if one is ever added, then the reel
            resolved from Instagram's public metadata. */}
        <source src="/nvidia-reel.mp4" type="video/mp4" />
        <source src="/api/nvidia/video" type="video/mp4" />
      </video>

      {!playing && (
        <button
          type="button"
          className="nv-play"
          onClick={() => videoRef.current?.play()}
          aria-label="Play video"
        >
          <Play size={26} fill="currentColor" />
        </button>
      )}
    </div>
  );
}
