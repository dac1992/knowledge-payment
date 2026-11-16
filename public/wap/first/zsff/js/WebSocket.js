(function (global) {
    var socketDebug = window.socketDebug == undefined ? false : window.socketDebug, 
        port = window.workermanConfig === undefined ? '20005' : window.workermanConfig.port;
    window.uid = window.uids === undefined ? 0 : window.uids;
    window.room = window.room === undefined ? 0 : window.room;
    var send = 0;
    
    var socket = {
        ws: null,
        // 连接状态: 0-未连接, 1-连接中, 2-已连接, 3-正在重连
        readyState: 0,
        // 重连配置
        reconnectConfig: {
            maxRetries: 10,           // 最大重连次数
            retryCount: 0,            // 当前重连次数
            retryDelay: 1000,         // 初始重连延迟
            maxRetryDelay: 30000,     // 最大重连延迟
            reconnectTimer: null      // 重连定时器
        },
        // 心跳配置
        heartCheck: {
            timeout: 30000,           // 心跳间隔30秒
            timeoutObj: null,         // 心跳定时器
            serverTimeoutObj: null,   // 服务器超时定时器
            serverTimeout: 10000,     // 服务器响应超时时间10秒
            missHeartCount: 0,        // 未响应心跳次数
            maxMissHeart: 3           // 最大未响应心跳次数
        },
        
        connect: function () {
            var that = this;
            
            // 防止重复连接
            if (that.readyState === 1 || that.readyState === 2) {
                socketDebug && console.log("WebSocket正在连接或已连接，跳过重复连接");
                return;
            }
            
            that.readyState = 1; // 连接中
            
            try {
                if (document.location.protocol == "https:") {
                    that.ws = new WebSocket("wss://" + document.domain + "/wss" + '?uid=' + window.uid + '&room=' + window.room);
                } else {
                    that.ws = new WebSocket("ws://" + document.domain + ":" + port + '?uid=' + window.uid + '&room=' + window.room);
                }
                
                that.ws.onopen = that.onopen;
                that.ws.onmessage = that.onmessage;
                that.ws.onclose = that.onclose;
                that.ws.onerror = that.onerror;
            } catch (e) {
                socketDebug && console.log("WebSocket连接异常:", e);
                that.readyState = 0;
                that.reconnect();
            }
        },
        
        onopen: function () {
            var that = socket;
            that.readyState = 2; // 已连接
            that.reconnectConfig.retryCount = 0; // 重置重连次数
            
            socketDebug && console.log("WebSocket连接成功");
            
            // 发送握手消息
            var joint = '{"type":"handshake","role":"user","uid":' + window.uid + ',"room":' + window.room + '}';
            that.ws.send(joint);
            
            // 启动心跳
            that.heartCheck.start();
        },
        
        onclose: function (e) {
            var that = socket;
            socketDebug && console.log("WebSocket连接关闭, code:", e.code, ", reason:", e.reason);
            
            that.readyState = 0;
            that.heartCheck.reset(); // 清理心跳定时器
            
            // 非主动关闭才重连
            if (send === 0) {
                that.reconnect();
            }
        },
        
        onerror: function (e) {
            var that = socket;
            socketDebug && console.log("WebSocket连接错误:", e);
            
            that.readyState = 0;
            that.heartCheck.reset();
            
            // 错误后尝试重连
            if (send === 0) {
                that.reconnect();
            }
        },
        
        onmessage: function (e) {
            var that = socket;
            
            try {
                var data = JSON.parse(e.data);
                if (data) {
                    send = 0;
                    // 收到任何消息都重置心跳计数
                    that.heartCheck.resetMissCount();
                }
                
                socketDebug && console.log("收到消息:", data);
                
                switch (data.type) {
                    case 'init':
                        break;
                    // 服务端ping客户端，需要响应pong
                    case 'ping':
                        that.ws.send('{"type":"pong"}');
                        break;
                    // 服务端响应客户端心跳
                    case 'pong':
                        // 心跳响应已处理
                        break;
                    case 'handshake':
                        break;
                    case 'reception':
                        break;
                    case 'live_ing':
                        vm.changLive(true, data.pull_url);
                        break;
                    case 'live_end':
                        vm.changLive(false);
                        break;
                    case 'message':
                        vm.setCommentArea(data.message, data.m_type, data.userInfo, data.user_type, data.id);
                        break;
                    case 'recall':
                        vm.CommentRecall(data.id);
                        break;
                    case 'ban':
                        vm.setBanUser(data.value);
                        break;
                    case "room_user_count":
                        vm.setUserCount(data.onLine_user_count, data.notice_content, data.user_type);
                        break;
                    case "live_reward":
                        vm.setGiftFloat(data);
                        break;
                }
            } catch (err) {
                socketDebug && console.log("消息解析错误:", err);
            }
        },
        
        // 重连机制
        reconnect: function () {
            var that = this;
            var config = that.reconnectConfig;
            
            // 清理之前的重连定时器
            if (config.reconnectTimer) {
                clearTimeout(config.reconnectTimer);
                config.reconnectTimer = null;
            }
            
            // 检查是否超过最大重连次数
            if (config.retryCount >= config.maxRetries) {
                socketDebug && console.log("已达到最大重连次数，停止重连");
                that.readyState = 0;
                return;
            }
            
            // 计算重连延迟（指数退避）
            var delay = Math.min(config.retryDelay * Math.pow(2, config.retryCount), config.maxRetryDelay);
            config.retryCount++;
            
            socketDebug && console.log("将在 " + delay + "ms 后进行第 " + config.retryCount + " 次重连");
            
            that.readyState = 3; // 正在重连
            
            config.reconnectTimer = setTimeout(function () {
                socketDebug && console.log("开始第 " + config.retryCount + " 次重连");
                that.connect();
            }, delay);
        },
        
        // 发送消息
        sendMsg: function (content, type, id) {
            var that = this;
            if (that.readyState !== 2) {
                socketDebug && console.log("WebSocket未连接，无法发送消息");
                return false;
            }
            
            try {
                that.ws.send("{content:'" + content + "',m_type:'" + type + "',room:" + id + ",type:'send',uid:" + window.uid + "}");
                return true;
            } catch (e) {
                socketDebug && console.log("发送消息失败:", e);
                return false;
            }
        },
        
        // 主动断开连接
        reconnection: function () {
            setTimeout(function () {
                if (send) {
                    socket.close();
                }
            }, 3000);
        },
        
        // 退出登录调用
        sendOut: function () {
            send = 1;
            socket.reconnection();
        },
        
        // 关闭连接
        close: function () {
            var that = this;
            that.heartCheck.reset();
            that.reconnectConfig.retryCount = that.reconnectConfig.maxRetries; // 阻止重连
            
            if (that.ws) {
                that.ws.close();
            }
            
            that.readyState = 0;
        },
        
        // 获取连接状态
        getReadyState: function () {
            return this.readyState;
        },
        
        // 手动重连
        manualReconnect: function () {
            var that = this;
            that.reconnectConfig.retryCount = 0; // 重置重连次数
            that.close();
            setTimeout(function () {
                that.connect();
            }, 100);
        }
    };
    
    // 心跳检测扩展
    socket.heartCheck.start = function () {
        var that = this;
        var socketObj = socket;
        
        that.reset();
        
        that.timeoutObj = setInterval(function () {
            // 检查连接状态
            if (socketObj.readyState !== 2) {
                that.reset();
                return;
            }
            
            // 发送心跳
            try {
                socketObj.ws.send('{"type":"ping"}');
                socketDebug && console.log("发送心跳 ping");
                
                // 增加未响应计数
                that.missHeartCount++;
                
                // 检查是否超过最大未响应次数
                if (that.missHeartCount >= that.maxMissHeart) {
                    socketDebug && console.log("心跳连续 " + that.missHeartCount + " 次未响应，判定连接已断开");
                    that.reset();
                    socketObj.ws.close();
                }
            } catch (e) {
                socketDebug && console.log("心跳发送失败:", e);
                that.reset();
                socketObj.reconnect();
            }
        }, that.timeout);
    };
    
    // 重置心跳
    socket.heartCheck.reset = function () {
        var that = this;
        
        if (that.timeoutObj) {
            clearInterval(that.timeoutObj);
            that.timeoutObj = null;
        }
        if (that.serverTimeoutObj) {
            clearTimeout(that.serverTimeoutObj);
            that.serverTimeoutObj = null;
        }
        that.missHeartCount = 0;
    };
    
    // 重置未响应计数
    socket.heartCheck.resetMissCount = function () {
        this.missHeartCount = 0;
    };
    
    // 页面可见性变化处理
    document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'visible') {
            // 页面变为可见时，检查连接状态
            if (socket.readyState !== 2) {
                socketDebug && console.log("页面恢复可见，检查并重连WebSocket");
                socket.reconnect();
            } else {
                // 连接正常，发送心跳检测
                try {
                    socket.ws.send('{"type":"ping"}');
                } catch (e) {
                    socketDebug && console.log("心跳发送失败:", e);
                }
            }
        }
    });
    
    // 页面卸载前关闭连接
    window.addEventListener('beforeunload', function () {
        send = 1; // 标记为主动关闭
        socket.close();
    });
    
    // 网络状态监听
    window.addEventListener('online', function () {
        socketDebug && console.log("网络已恢复，尝试重连WebSocket");
        socket.reconnectConfig.retryCount = 0;
        socket.reconnect();
    });
    
    window.addEventListener('offline', function () {
        socketDebug && console.log("网络已断开");
        socket.heartCheck.reset();
    });
    
    // 初始化连接
    socket.connect();
    global.socket = socket;
    
    return socket;
}(this));
