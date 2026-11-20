import { useState, useEffect, useRef, useCallback } from "react";
import { storage, STORAGE_KEYS } from "./storage";
import { followMe, followsHost, getParty, nextInQueue, playFromQueue } from "../mobile/party.js";

const _todayForEpisodes = (() => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
})();

/**
 * "Up next" countdown when the credits start.
 * In a watch party only the host moves on: the next title from the party
 * queue comes first, otherwise the next episode (and everyone follows).
 */
export function useAutoplay({ nextEp, playEpisode, restricted, partyItem }) {
  const [autoplayCountdown, setAutoplayCountdown] = useState(null);
  const [upNextQueue, setUpNextQueue] = useState(null); // party queue item shown instead of nextEp
  const countdownIntervalRef = useRef(null);
  const countdownStartedRef = useRef(false);
  const totalRef = useRef(0);

  // Keep references to nextEp and playEpisode up-to-date
  const nextEpRef = useRef(nextEp);
  useEffect(() => {
    nextEpRef.current = nextEp;
  }, [nextEp]);

  const playEpisodeRef = useRef(playEpisode);
  useEffect(() => {
    playEpisodeRef.current = playEpisode;
  }, [playEpisode]);

  const partyItemRef = useRef(partyItem);
  useEffect(() => {
    partyItemRef.current = partyItem;
  }, [partyItem]);
  const queueRef = useRef(null);

  const cancelAutoplay = useCallback(() => {
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
    setAutoplayCountdown(null);
    setUpNextQueue(null);
    queueRef.current = null;
  }, []);

  const goNext = useCallback(() => {
    const q = queueRef.current;
    if (q) {
      playFromQueue(q.key);
      return;
    }
    if (playEpisodeRef.current && nextEpRef.current) {
      playEpisodeRef.current(nextEpRef.current);
      if (getParty()?.isHost && partyItemRef.current) followMe(partyItemRef.current);
    }
  }, []);

  const triggerAutoplay = useCallback(() => {
    // Read fresh setting from storage
    const isEnabled = storage.get(STORAGE_KEYS.AUTOPLAY_NEXT_ENABLED) ?? true;
    if (!isEnabled) return;
    // watch party guests: the host decides what's next
    if (followsHost()) return;

    const q = getParty()?.isHost ? nextInQueue() : null;
    const currentNextEp = nextEpRef.current;
    if (!q) {
      if (!currentNextEp) return;
      const epUnreleased = currentNextEp.air_date ? new Date(currentNextEp.air_date) > _todayForEpisodes : false;
      if (restricted || epUnreleased) return;
    }

    const duration = Number(storage.get(STORAGE_KEYS.AUTOPLAY_NEXT_DURATION) ?? 10);

    cancelAutoplay(); // Clear any existing active timer
    queueRef.current = q;
    setUpNextQueue(q);
    totalRef.current = duration;

    if (duration === 0) {
      // 0 means manual only: show the card, but do not play automatically
      setAutoplayCountdown(0);
    } else {
      setAutoplayCountdown(duration);
      countdownIntervalRef.current = setInterval(() => {
        setAutoplayCountdown((prev) => {
          if (prev <= 1) {
            clearInterval(countdownIntervalRef.current);
            countdownIntervalRef.current = null;
            setTimeout(() => {
              goNext();
              setUpNextQueue(null);
              queueRef.current = null;
            }, 0);
            return null;
          }
          return prev - 1;
        });
      }, 1000);
    }
  }, [restricted, cancelAutoplay, goNext]);

  const playNow = useCallback(() => {
    const q = queueRef.current;
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
    setAutoplayCountdown(null);
    queueRef.current = q;
    goNext();
    setUpNextQueue(null);
    queueRef.current = null;
  }, [goNext]);

  const resetAutoplay = useCallback(() => {
    cancelAutoplay();
    countdownStartedRef.current = false;
  }, [cancelAutoplay]);

  // Clean up interval on unmount
  useEffect(() => {
    return () => {
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
      }
    };
  }, []);

  return {
    autoplayCountdown,
    autoplayTotal: totalRef.current,
    upNextQueue,
    countdownStarted: countdownStartedRef.current,
    setCountdownStarted: (val) => {
      countdownStartedRef.current = val;
    },
    triggerAutoplay,
    cancelAutoplay,
    playNow,
    resetAutoplay,
  };
}
