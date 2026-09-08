'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { RecordingClock } from '@/lib/recording-clock';

export const MAX_AUDIO_BYTES = 20 * 1024 * 1024;
export type RecorderState =
  | 'idle'
  | 'requesting'
  | 'recording'
  | 'paused'
  | 'stopping'
  | 'stopped';
export function useRecorder() {
  const [state, setState] = useState<RecorderState>('idle');
  const [seconds, setSeconds] = useState(0);
  const [levels, setLevels] = useState<number[]>([]);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [error, setError] = useState('');
  const [device, setDevice] = useState('笔记本默认麦克风');
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const audioContext = useRef<AudioContext | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const clock = useRef(new RecordingClock());
  const mounted = useRef(true);
  const acquiring = useRef(false);
  const cleanup = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    stream.current?.getTracks().forEach((track) => {
      track.onended = null;
      track.stop();
    });
    stream.current = null;
    void audioContext.current?.close().catch(() => {});
    audioContext.current = null;
  }, []);
  const stop = useCallback(() => {
    const r = recorder.current;
    if (!r || r.state === 'inactive') return;
    clock.current.pause();
    if (mounted.current) {
      setState('stopping');
      setSeconds(clock.current.seconds());
    }
    r.stop();
    cleanup();
  }, [cleanup]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const r = recorder.current;
      if (r && r.state !== 'inactive') {
        r.onstop = null;
        r.ondataavailable = null;
        r.stop();
      }
      cleanup();
    };
  }, [cleanup]);
  const start = async () => {
    if (
      acquiring.current ||
      (recorder.current && recorder.current.state !== 'inactive')
    )
      return;
    acquiring.current = true;
    setError('');
    setState('requesting');
    try {
      if (
        !window.isSecureContext ||
        !navigator.mediaDevices?.getUserMedia ||
        typeof MediaRecorder === 'undefined'
      )
        throw new Error(
          '请使用 Chrome，通过 HTTPS 或 localhost 打开网页后录音。',
        );
      const media = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          channelCount: 1,
        },
      });
      if (!mounted.current) {
        media.getTracks().forEach((t) => t.stop());
        return;
      }
      stream.current = media;
      const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find(
        (t) => MediaRecorder.isTypeSupported(t),
      );
      const r = new MediaRecorder(media, {
        ...(mime ? { mimeType: mime } : {}),
        audioBitsPerSecond: 32000,
      });
      recorder.current = r;
      const chunks: Blob[] = [];
      let bytes = 0;
      r.ondataavailable = (event) => {
        if (event.data.size) {
          chunks.push(event.data);
          bytes += event.data.size;
        }
        if (bytes >= MAX_AUDIO_BYTES && r.state !== 'inactive') {
          setError('已达到本次录音大小上限，录音已结束，请下载备份。');
          stop();
        }
      };
      r.onstop = () => {
        cleanup();
        clock.current.pause();
        if (!mounted.current) return;
        const result = new Blob(chunks, { type: r.mimeType || 'audio/webm' });
        setBlob(result.size ? result : null);
        setLevels([]);
        setState('stopped');
        setSeconds(clock.current.seconds());
        if (!result.size)
          setError('未获取到音频，请检查麦克风后新建面试重试。');
      };
      r.onerror = () => {
        setError('录音遇到错误，已保留收到的音频，请下载后检查。');
        stop();
      };
      media.getAudioTracks().forEach((track) => {
        track.onended = () => {
          setError('麦克风已断开，录音结束，请检查已保存的音频。');
          stop();
        };
      });
      setDevice(media.getAudioTracks()[0]?.label || '默认麦克风');
      // Meter failure must not discard an otherwise valid microphone recording.
      let analyser: AnalyserNode | null = null;
      try {
        const context = new AudioContext();
        audioContext.current = context;
        analyser = context.createAnalyser();
        analyser.fftSize = 128;
        context.createMediaStreamSource(media).connect(analyser);
        void context.resume().catch(() => {});
      } catch {
        /* Recording can continue without the optional level meter. */
      }
      clock.current.reset();
      clock.current.start();
      setSeconds(0);
      setBlob(null);
      r.start(1000);
      setState('recording');
      timer.current = setInterval(() => {
        setSeconds(clock.current.seconds());
        if (clock.current.seconds() >= 3600) {
          setError('已录满 60 分钟，录音已结束，请下载备份。');
          stop();
          return;
        }
        if (r.state === 'recording' && analyser) {
          const data = new Uint8Array(analyser.frequencyBinCount);
          analyser.getByteFrequencyData(data);
          setLevels(Array.from(data.slice(0, 55), (n) => n / 255));
        } else setLevels([]);
      }, 120);
    } catch (e) {
      cleanup();
      setState('idle');
      const name = e instanceof Error ? e.name : '';
      setError(
        name === 'NotAllowedError'
          ? '麦克风未获授权。请在 Chrome 地址栏的网站设置中允许麦克风，再试一次。'
          : name === 'NotFoundError'
            ? '未发现麦克风，请连接设备后重试。'
            : name === 'NotReadableError'
              ? '麦克风无法读取，可能正被其他程序占用。'
              : e instanceof Error
                ? e.message
                : '录音启动失败，请重试。',
      );
    } finally {
      acquiring.current = false;
    }
  };
  const pause = () => {
    if (recorder.current?.state === 'recording') {
      recorder.current.pause();
      clock.current.pause();
      setState('paused');
    }
  };
  const resume = () => {
    if (recorder.current?.state === 'paused') {
      recorder.current.resume();
      clock.current.start();
      setState('recording');
    }
  };
  const reset = () => {
    cleanup();
    recorder.current = null;
    clock.current.reset();
    setState('idle');
    setSeconds(0);
    setBlob(null);
    setError('');
    setLevels([]);
  };
  return {
    state,
    seconds,
    levels,
    blob,
    error,
    device,
    start,
    pause,
    resume,
    stop,
    reset,
  };
}
