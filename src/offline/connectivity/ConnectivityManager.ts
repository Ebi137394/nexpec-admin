import NetInfo from '@react-native-community/netinfo';
import { EventEmitter } from 'events';

class ConnectivityManager extends EventEmitter {
  private static instance: ConnectivityManager;
  private isConnected: boolean = false;

  static getInstance() {
    if (!ConnectivityManager.instance) ConnectivityManager.instance = new ConnectivityManager();
    return ConnectivityManager.instance;
  }

  async initialize() {
    NetInfo.addEventListener(state => {
      const wasOffline = !this.isConnected;
      this.isConnected = state.isConnected ?? false;
      if (wasOffline && this.isConnected) this.emit('connectionRestored');
    });
  }

  isOnline() { return this.isConnected; }
}
export const connectivityManager = ConnectivityManager.getInstance();