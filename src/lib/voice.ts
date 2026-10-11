import { supabase, localToken, localSocket } from './supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';
export class VoiceChat {
  private channel: RealtimeChannel | null = null;
  private connection: RTCPeerConnection | null = null;
  private stream: MediaStream | null = null;
  private pending: RTCIceCandidateInit[] = [];
  private audio = new Audio();
  private stopped = false;
  private socket: WebSocket | null = null;
  async start(roomId: string, userId: string, isHost: boolean, onState: (state: string) => void) {
    if (!navigator.mediaDevices) throw new Error('VOICE_UNAVAILABLE');
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
    if (this.stopped) { this.stream.getTracks().forEach(track => track.stop()); return; }
    let iceServers: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];
    const token = supabase ? (await supabase.auth.getSession()).data.session?.access_token : localToken();
    try {
      const response = await fetch('/api/ice', { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000) });
      if (response.ok) iceServers = (await response.json()).iceServers;
    } catch { onState('stun'); }
    if (this.stopped) return;
    const peer = new RTCPeerConnection({ iceServers }); this.connection = peer;
    this.stream.getTracks().forEach(track => peer.addTrack(track, this.stream!));
    peer.ontrack = event => { this.audio.srcObject = event.streams[0]; this.audio.autoplay = true; void this.audio.play().catch(() => onState('tap')); };
    peer.onconnectionstatechange = () => onState(peer.connectionState);
    const send = (payload: Record<string, unknown>) => {
      if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({type:'signal',payload}));
      return this.channel?.send({ type: 'broadcast', event: 'signal', payload: { ...payload, from: userId } });
    };
    peer.onicecandidate = event => { if (event.candidate) void send({ candidate: event.candidate.toJSON() }); };
    const signal = async (payload: Record<string, any>) => {
      if (payload.from === userId || this.stopped) return;
      try {
        if (payload.ready && isHost) {
          if (peer.signalingState === 'stable') { const offer = await peer.createOffer(); await peer.setLocalDescription(offer); await send({ description: offer }); }
          else if (peer.localDescription?.type === 'offer') await send({ description: peer.localDescription.toJSON() });
        }
        if (payload.ready && !isHost) await send({ ready: true });
        if (payload.description) {
          await peer.setRemoteDescription(payload.description);
          for (const candidate of this.pending.splice(0)) await peer.addIceCandidate(candidate);
          if (payload.description.type === 'offer') { const answer = await peer.createAnswer(); await peer.setLocalDescription(answer); await send({ description: answer }); }
        }
        if (payload.candidate) { if (peer.remoteDescription) await peer.addIceCandidate(payload.candidate); else this.pending.push(payload.candidate); }
        if (payload.left) onState('disconnected');
      } catch { onState('failed'); }
    };
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('VOICE_TIMEOUT')), 12000);
      const statusChanged = (status: string) => {
        if (this.stopped) { clearTimeout(timer); resolve(); return; }
        if (status === 'SUBSCRIBED') { clearTimeout(timer); void send({ ready: true }); onState('waiting'); resolve(); }
        if (status === 'CHANNEL_ERROR' || status === 'CLOSED') { clearTimeout(timer); this.stop(); onState('off'); reject(new Error('VOICE_UNAVAILABLE')); }
      };
      if (supabase) {
        this.channel = supabase.channel(`voice:${roomId}`, { config: { private: true, broadcast: { self: false } } });
        this.channel.on('broadcast', { event:'signal' }, ({payload}) => void signal(payload)).subscribe(statusChanged);
      } else this.socket = localSocket(roomId,'voice', data => { if (data.type === 'signal') void signal(data.payload); },statusChanged);
    });
  }
  mute(muted: boolean) { this.stream?.getAudioTracks().forEach(track => { track.enabled = !muted; }); }
  resume() { void this.audio.play(); }
  stop() {
    this.stopped = true;
    void this.channel?.send({ type: 'broadcast', event: 'signal', payload: { left: true } });
    this.stream?.getTracks().forEach(track => track.stop()); this.connection?.close();
    if (this.channel && supabase) void supabase.removeChannel(this.channel);
    this.socket?.close();
    this.audio.pause(); this.audio.srcObject = null;
  }
}
