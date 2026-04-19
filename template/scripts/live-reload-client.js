// Live Reload Client - Always loaded, connects to dev server
(function() {
    // Only run in development (when dev server is running)
    const isDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    if (!isDev) return;

    // Create visual indicator
    const indicator = document.createElement('div');
    indicator.id = 'live-reload-indicator';
    indicator.style.cssText = 'position: fixed; bottom: 20px; right: 20px; background: #4caf50; color: white; padding: 8px 16px; border-radius: 20px; font-size: 12px; font-family: monospace; z-index: 9999; box-shadow: 0 2px 8px rgba(0,0,0,0.2); transition: all 0.3s; cursor: pointer;';
    indicator.textContent = '🔌 Connecting...';
    
    // Wait for body to be ready
    function addIndicator() {
        if (document.body) {
            document.body.appendChild(indicator);
        } else {
            setTimeout(addIndicator, 100);
        }
    }
    addIndicator();

    let ws;
    let reconnectAttempts = 0;
    const maxReconnectAttempts = 10;
    const port = window.location.port || 3000;
    function connect() {
        try {
            console.log('🔌 Connecting to live reload WebSocket...');
            ws = new WebSocket(`ws://localhost:${port}`);

            ws.onopen = function() {
                console.log('✅ Live reload connected');
                reconnectAttempts = 0;
                indicator.style.background = '#4caf50';
                indicator.textContent = '✅ Live Reload';
                setTimeout(function() {
                    indicator.style.opacity = '0.3';
                }, 2000);
            };

            ws.onmessage = function(event) {
                if (event.data === 'reload') {
                    console.log('🔄 Changes detected, reloading...');
                    indicator.style.opacity = '1';
                    indicator.style.background = '#2196f3';
                    indicator.textContent = '🔄 Reloading...';
                    
                    // Small delay to show the indicator
                    setTimeout(function() {
                        window.location.reload();
                    }, 100);
                }
            };

            ws.onerror = function(err) {
                console.log('⚠️ WebSocket error:', err);
            };

            ws.onclose = function() {
                console.log('⚠️ Live reload disconnected');
                indicator.style.background = '#ff9800';
                indicator.style.opacity = '1';
                indicator.textContent = '⚠️ Disconnected';

                // Try to reconnect
                if (reconnectAttempts < maxReconnectAttempts) {
                    reconnectAttempts++;
                    console.log(`Reconnecting... attempt ${reconnectAttempts}`);
                    setTimeout(connect, 2000);
                } else {
                    indicator.textContent = '❌ Offline';
                    indicator.style.background = '#f44336';
                }
            };
        } catch (e) {
            console.error('Failed to create WebSocket:', e);
            indicator.style.background = '#f44336';
            indicator.textContent = '❌ Error';
        }
    }

    // Start connection when page loads
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', connect);
    } else {
        connect();
    }

    // Show indicator on hover
    indicator.addEventListener('mouseenter', function() {
        indicator.style.opacity = '1';
    });
    indicator.addEventListener('mouseleave', function() {
        if (indicator.textContent.includes('Live Reload')) {
            indicator.style.opacity = '0.3';
        }
    });

    // Click to manually reload
    indicator.addEventListener('click', function() {
        window.location.reload();
    });
})();
