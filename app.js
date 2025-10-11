// アプリケーションのメインクラス
class PersonDetectionApp {
    constructor() {
        // 定数の定義
        this.MAX_GALLERY_ITEMS = 20;
        this.SKELETON_COLOR = '#00ff00';
        this.KEYPOINT_COLOR = '#ff0000';
        this.POSE_CONNECTIONS = [
            [11, 12], // shoulders
            [11, 13], [13, 15], // left arm
            [12, 14], [14, 16], // right arm
            [11, 23], [12, 24], // torso
            [23, 24], // hips
            [23, 25], [25, 27], // left leg
            [24, 26], [26, 28]  // right leg
        ];

        this.video = document.getElementById('video');
        this.canvas = document.getElementById('canvas');
        this.ctx = this.canvas.getContext('2d');
        this.overlayCanvas = document.getElementById('detection-overlay');
        this.overlayCtx = this.overlayCanvas.getContext('2d');

        this.stream = null;
        this.isDetecting = false;
        this.captureCount = 0;
        this.lastCaptureTime = 0;
        this.pose = null;

        // 時系列一貫性チェック用
        this.previousLandmarks = null;
        this.detectionHistory = [];
        this.REQUIRED_CONSECUTIVE_DETECTIONS = 3;  // 3フレーム連続検出で誤検出を減らす
        this.MAX_MOVEMENT_THRESHOLD = 0.4;  // 最大移動閾値をさらに緩和（実用重視）
        this.consecutiveDetectionCount = 0;
        this.smoothingFactor = 0.3;  // ランドマークの平滑化係数

        this.initializeElements();
        this.initializeMediaPipe();
        this.bindEvents();
        this.setupKeyboardShortcuts();

        // 厳格モードで固定初期化
        this.initializeStrictMode();
    }

    initializeElements() {
        this.startBtn = document.getElementById('start-btn');
        this.stopBtn = document.getElementById('stop-btn');
        this.toggleDetectionBtn = document.getElementById('toggle-detection');
        this.detectionStatus = document.getElementById('detection-status');
        this.captureCountEl = document.getElementById('capture-count');
        this.autoCapture = document.getElementById('auto-capture');
        this.captureInterval = document.getElementById('capture-interval');
        // 検出モード切り替えでconfidence-threshold要素は削除されたため、動的に閾値を管理
        this.currentConfidenceThreshold = 0.5; // デフォルト値（strict mode - 実用的調整）
        // threshold-value要素も削除されたため、この参照も削除
        // 厳格モードのみに固定したため、detection-mode要素は不要
        this.gallery = document.getElementById('image-gallery');
        this.notification = document.getElementById('notification');

        // 一括操作ボタン
        this.selectAllBtn = document.getElementById('select-all-btn');
        this.deselectAllBtn = document.getElementById('deselect-all-btn');
        this.downloadAllBtn = document.getElementById('download-all-btn');
        this.deleteSelectedBtn = document.getElementById('delete-selected-btn');
        this.clearAllBtn = document.getElementById('clear-all-btn');

        // 選択状態管理
        this.selectedImages = new Set();
    }

    initializeMediaPipe() {
        // MediaPipe Poseの初期化
        this.pose = new Pose({
            locateFile: (file) => {
                return `https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5.1675469404/${file}`;
            }
        });

        this.pose.setOptions({
            modelComplexity: 2,  // より高精度なモデルを使用
            smoothLandmarks: true,
            enableSegmentation: true,  // 背景セグメンテーション有効化
            minDetectionConfidence: 0.6,  // 検出精度を上げて誤検出を減らす
            minTrackingConfidence: 0.6,  // トラッキング精度も向上
            refineLandmarks: true  // 顔のランドマークを精緻化
        });

        this.pose.onResults((results) => this.onPoseResults(results));
    }

    bindEvents() {
        this.startBtn.addEventListener('click', () => this.startCamera());
        this.stopBtn.addEventListener('click', () => this.stopCamera());
        this.toggleDetectionBtn.addEventListener('click', () => this.toggleDetection());
        // confidence-threshold要素は削除されたため、このイベントリスナーも削除

        // 厳格モードのみなのでモード切り替えイベントリスナーは不要

        // 一括操作ボタンのイベントリスナー
        this.selectAllBtn.addEventListener('click', () => this.selectAllImages());
        this.deselectAllBtn.addEventListener('click', () => this.deselectAllImages());
        this.downloadAllBtn.addEventListener('click', () => this.downloadAllImages());
        this.deleteSelectedBtn.addEventListener('click', () => this.deleteSelectedImages());
        this.clearAllBtn.addEventListener('click', () => this.clearAllImages());
    }

    async startCamera() {
        try {
            this.stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    width: { ideal: 1280 },
                    height: { ideal: 720 },
                    facingMode: 'user'
                }
            });

            this.video.srcObject = this.stream;

            this.video.addEventListener('loadedmetadata', () => {
                this.canvas.width = this.video.videoWidth;
                this.canvas.height = this.video.videoHeight;
                this.overlayCanvas.width = this.video.videoWidth;
                this.overlayCanvas.height = this.video.videoHeight;
            });

            this.startBtn.disabled = true;
            this.stopBtn.disabled = false;
            this.toggleDetectionBtn.disabled = false;

            this.showNotification('カメラが開始されました');
        } catch (error) {
            console.error('カメラの起動に失敗しました:', error);
            let message = 'カメラの起動に失敗しました。';

            if (error.name === 'NotAllowedError') {
                message = 'カメラへのアクセスが拒否されました。ブラウザの設定を確認し、カメラのアクセスを許可してください。';
            } else if (error.name === 'NotFoundError') {
                message = '利用可能なカメラが見つかりませんでした。';
            } else if (error.name === 'NotReadableError') {
                message = 'カメラが他のアプリケーションで使用中の可能性があります。';
            } else if (error.name === 'OverconstrainedError') {
                message = '要求されたカメラ設定がサポートされていません。';
            }

            this.showNotification(message, 'error');
        }
    }

    stopCamera() {
        if (this.stream) {
            this.stream.getTracks().forEach(track => track.stop());
            this.stream = null;
            this.video.srcObject = null;
        }

        this.isDetecting = false;
        this.startBtn.disabled = false;
        this.stopBtn.disabled = true;
        this.toggleDetectionBtn.disabled = true;
        this.toggleDetectionBtn.textContent = '検出開始';
        this.detectionStatus.textContent = '停止';
        this.detectionStatus.classList.remove('active');

        this.clearOverlay();
        this.showNotification('カメラが停止されました');
    }

    toggleDetection() {
        if (this.isDetecting) {
            this.stopDetection();
        } else {
            this.startDetection();
        }
    }

    async startDetection() {
        this.isDetecting = true;
        this.toggleDetectionBtn.textContent = '検出停止';
        this.detectionStatus.textContent = '検出中';
        this.detectionStatus.classList.add('active');

        this.showNotification('人物検出を開始しました');
        this.detectionLoop();
    }

    detectionLoop() {
        console.log('[DEBUG] 🔄 detectionLoop実行中 - isDetecting:', this.isDetecting, 'stream:', !!this.stream);

        if (!this.isDetecting) {
            console.log('[DEBUG] ⚠️ 検出が停止されているためループ終了');
            this.clearOverlay();
            return;
        }

        if (!this.stream) {
            console.log('[DEBUG] ⚠️ ストリームが存在しないためループ終了');
            this.clearOverlay();
            return;
        }

        // ビデオストリーム状態の詳細検証
        if (!this.validateVideoStreamState()) {
            console.log('[DEBUG] ⚠️ ビデオストリーム状態検証失敗 - 次のフレームまで待機');
            requestAnimationFrame(() => this.detectionLoop());
            return;
        }

        // MediaPipe入力の最終検証
        if (!this.validateMediaPipeInput()) {
            console.log('[DEBUG] ⚠️ MediaPipe入力検証失敗 - フレームスキップ');
            requestAnimationFrame(() => this.detectionLoop());
            return;
        }

        console.log('[DEBUG] 📤 MediaPipeにビデオフレームを送信中...');
        this.pose.send({ image: this.video }).then(() => {
            console.log('[DEBUG] ✅ MediaPipeフレーム送信成功');
            requestAnimationFrame(() => this.detectionLoop());
        }).catch((error) => {
            console.error('[DEBUG] ❌ 検出処理でエラーが発生しました:', error);
            this.handleMediaPipeError(error);
        });
    }

    validateVideoStreamState() {
        try {
            // ビデオ要素の基本状態チェック
            if (!this.video) {
                console.log('[DEBUG] ❌ ビデオ要素が存在しません');
                return false;
            }

            // ビデオの読み込み状態チェック
            if (this.video.readyState < 2) { // HAVE_CURRENT_DATA (2) 以上が必要
                console.log(`[DEBUG] ❌ ビデオが準備できていません - readyState: ${this.video.readyState}`);
                return false;
            }

            // ビデオサイズの検証
            const videoWidth = this.video.videoWidth;
            const videoHeight = this.video.videoHeight;

            if (videoWidth <= 0 || videoHeight <= 0) {
                console.log(`[DEBUG] ❌ 無効なビデオサイズ - width: ${videoWidth}, height: ${videoHeight}`);
                return false;
            }

            // ビデオの再生状態チェック
            if (this.video.paused || this.video.ended) {
                console.log(`[DEBUG] ❌ ビデオが停止状態 - paused: ${this.video.paused}, ended: ${this.video.ended}`);
                return false;
            }

            // ビデオストリームのアクティブ状態チェック
            if (this.stream) {
                const tracks = this.stream.getVideoTracks();
                if (tracks.length === 0) {
                    console.log('[DEBUG] ❌ ビデオトラックが存在しません');
                    return false;
                }

                const activeTrack = tracks[0];
                if (!activeTrack.enabled || activeTrack.readyState !== 'live') {
                    console.log(`[DEBUG] ❌ ビデオトラックが非アクティブ - enabled: ${activeTrack.enabled}, readyState: ${activeTrack.readyState}`);
                    return false;
                }
            }

            // キャンバスサイズとの整合性チェック
            if (this.canvas && (this.canvas.width !== videoWidth || this.canvas.height !== videoHeight)) {
                console.log(`[DEBUG] ⚠️ キャンバスサイズ不整合 - canvas: ${this.canvas.width}x${this.canvas.height}, video: ${videoWidth}x${videoHeight}`);
                // キャンバスサイズを自動調整
                this.canvas.width = videoWidth;
                this.canvas.height = videoHeight;
                this.overlayCanvas.width = videoWidth;
                this.overlayCanvas.height = videoHeight;
                console.log('[DEBUG] ✅ キャンバスサイズを自動調整しました');
            }

            console.log(`[DEBUG] ✅ ビデオストリーム状態良好 - ${videoWidth}x${videoHeight}, readyState: ${this.video.readyState}`);
            return true;

        } catch (error) {
            console.error('[DEBUG] ❌ ビデオストリーム状態検証でエラー:', error);
            return false;
        }
    }

    validateMediaPipeInput() {
        try {
            // ビデオ要素の基本検証
            if (!this.video) {
                console.log('[DEBUG] ❌ MediaPipe入力検証: ビデオ要素なし');
                return false;
            }

            // ビデオサイズが有効範囲内かチェック
            const width = this.video.videoWidth;
            const height = this.video.videoHeight;

            // ROIエラー防止: 最小サイズ要件
            if (width < 64 || height < 64) {
                console.log(`[DEBUG] ❌ MediaPipe入力検証: サイズが小さすぎる - ${width}x${height} (最小: 64x64)`);
                return false;
            }

            // 最大サイズ制限
            if (width > 1920 || height > 1080) {
                console.log(`[DEBUG] ❌ MediaPipe入力検証: サイズが大きすぎる - ${width}x${height} (最大: 1920x1080)`);
                return false;
            }

            // アスペクト比の妥当性チェック
            const aspectRatio = width / height;
            if (aspectRatio < 0.5 || aspectRatio > 3.0) {
                console.log(`[DEBUG] ❌ MediaPipe入力検証: 異常なアスペクト比 - ${aspectRatio.toFixed(2)}`);
                return false;
            }

            // フレームレートチェック（フレームドロップ検出）
            const now = performance.now();
            if (this.lastFrameTime) {
                const frameInterval = now - this.lastFrameTime;
                if (frameInterval < 16) { // 60fps以上は制限
                    console.log(`[DEBUG] ⚠️ MediaPipe入力検証: フレームレートが高すぎる - ${frameInterval.toFixed(1)}ms間隔`);
                    return false;
                }
            }
            this.lastFrameTime = now;

            console.log(`[DEBUG] ✅ MediaPipe入力検証成功 - ${width}x${height}, アスペクト比: ${aspectRatio.toFixed(2)}`);
            return true;

        } catch (error) {
            console.error('[DEBUG] ❌ MediaPipe入力検証でエラー:', error);
            return false;
        }
    }

    handleMediaPipeError(error) {
        console.error('[DEBUG] 🚨 MediaPipeエラーハンドリング開始:', error);

        // エラーカウントの管理
        if (!this.mediaPipeErrorCount) {
            this.mediaPipeErrorCount = 0;
        }
        this.mediaPipeErrorCount++;

        // ROI関連エラーの特別処理
        if (error.message && error.message.includes('ROI')) {
            console.error('[DEBUG] 🚨 ROI関連エラー検出 - MediaPipeの再初期化を試行');
            this.reinitializeMediaPipe();
            return;
        }

        // WebGL関連エラーの処理
        if (error.message && (error.message.includes('WebGL') || error.message.includes('texture'))) {
            console.error('[DEBUG] 🚨 WebGL関連エラー検出 - コンテキストリセット待機');
            setTimeout(() => {
                if (this.isDetecting) {
                    this.detectionLoop();
                }
            }, 500);
            return;
        }

        // 連続エラーの場合は検出停止
        if (this.mediaPipeErrorCount > 5) {
            console.error('[DEBUG] 🚨 MediaPipeエラーが連続発生 - 検出を停止');
            this.stopDetection();
            this.showNotification('MediaPipeエラーが発生しました。検出を停止しました。', 'error');
            return;
        }

        // 通常のエラーは短い遅延後に再試行
        setTimeout(() => {
            if (this.isDetecting) {
                console.log('[DEBUG] 🔄 MediaPipeエラー後の再試行');
                this.detectionLoop();
            }
        }, 100);
    }

    reinitializeMediaPipe() {
        console.log('[DEBUG] 🔄 MediaPipeの再初期化開始');

        try {
            // 既存のMediaPipeインスタンスをクリーンアップ
            if (this.pose) {
                this.pose.close();
            }

            // 短い遅延後に再初期化
            setTimeout(() => {
                this.initializeMediaPipe();
                console.log('[DEBUG] ✅ MediaPipe再初期化完了');

                // エラーカウントをリセット
                this.mediaPipeErrorCount = 0;

                // 検出中であれば再開
                if (this.isDetecting) {
                    setTimeout(() => this.detectionLoop(), 500);
                }
            }, 1000);

        } catch (error) {
            console.error('[DEBUG] ❌ MediaPipe再初期化に失敗:', error);
            this.stopDetection();
            this.showNotification('MediaPipeの再初期化に失敗しました。', 'error');
        }
    }

    stopDetection() {
        this.isDetecting = false;
        this.toggleDetectionBtn.textContent = '検出開始';
        this.detectionStatus.textContent = '待機中';
        this.detectionStatus.classList.remove('active');

        // 検証履歴をリセット
        this.detectionHistory = [];
        this.previousLandmarks = null;

        this.clearOverlay();
        this.showNotification('人物検出を停止しました');
    }

    onPoseResults(results) {
        try {
            console.log('[DEBUG] 🔄 onPoseResults関数が呼ばれました', new Date().toLocaleTimeString());

            this.clearOverlay();

            // より詳細なデバッグ情報
            console.log('[DEBUG] 📊 MediaPipeの結果:');
            console.log('[DEBUG] - poseLandmarks存在:', !!results.poseLandmarks);
            console.log('[DEBUG] - segmentationMask存在:', !!results.segmentationMask);

            if (results.poseLandmarks) {
                console.log('[DEBUG] ✅ ポーズランドマークが検出されました！キーポイント数:', results.poseLandmarks.length);

                // 厳格モード用の多層防御システム実行
                console.log('[DEBUG] 🛡️ 厳格モード - 多層防御システム開始');

                // 基本的な描画
                this.drawPoseOverlay(results);

                // Step 1: 基本信頼度計算
                const confidence = this.calculateConfidence(results.poseLandmarks);
                console.log(`[DEBUG] 📊 基本信頼度: ${confidence.toFixed(3)}, 閾値: ${this.currentConfidenceThreshold}`);

                if (confidence < this.currentConfidenceThreshold) {
                    this.consecutiveDetectionCount = 0;
                    console.log('[DEBUG] ❌ Step 1失敗: 基本信頼度不足 - 連続検出カウントリセット');
                    return;
                }

                // Step 2: 構造的妥当性チェック
                if (!this.validatePoseStructure(results.poseLandmarks)) {
                    this.consecutiveDetectionCount = 0;
                    console.log('[DEBUG] ❌ Step 2失敗: 構造的妥当性チェック不合格 - 連続検出カウントリセット');
                    return;
                }

                // Step 3: 身体比率チェック（現在はスキップ - 実用性重視）
                console.log('[DEBUG] ✅ Step 3: 身体比率チェックはスキップ（実用性重視）');

                // Step 4: 時系列一貫性チェック
                if (!this.validateTemporalConsistency(results.poseLandmarks)) {
                    this.consecutiveDetectionCount = 0;
                    console.log('[DEBUG] ❌ Step 4失敗: 時系列一貫性チェック不合格 - 連続検出カウントリセット');
                    return;
                }

                // すべてのチェックをパス
                this.consecutiveDetectionCount++;
                console.log(`[DEBUG] ✅ 全ての検証をパス - 連続検出カウント: ${this.consecutiveDetectionCount}/${this.REQUIRED_CONSECUTIVE_DETECTIONS}`);

                if (this.consecutiveDetectionCount >= this.REQUIRED_CONSECUTIVE_DETECTIONS) {
                    console.log('[DEBUG] 🎯 厳格モード検出成功 - 人物検出確定');
                    this.onPersonDetected(confidence);
                }
            } else {
                this.consecutiveDetectionCount = 0;
                console.log('[DEBUG] ❌ ポーズランドマークが検出されませんでした - 連続検出カウントリセット');
            }
        } catch (error) {
            console.error('onPoseResultsでエラーが発生しました:', error);
            // エラーが頻発する場合は検出を停止
            if (this.poseErrorCount === undefined) {
                this.poseErrorCount = 0;
            }
            this.poseErrorCount++;

            if (this.poseErrorCount > 10) {
                console.error('エラーが頻発したため、検出を停止します');
                this.stopDetection();
                this.showNotification('検出エラーが発生しました。検出を停止しました。', 'error');
            }
        }
    }

    calculateConfidence(landmarks) {
        // キーポイントに重み付けを行い、より正確な信頼度を計算
        const weightedKeyPoints = [
            { point: landmarks[0], weight: 1.5, name: 'nose' },   // 鼻（高重要度）
            { point: landmarks[11], weight: 1.0, name: 'left_shoulder' },  // 左肩
            { point: landmarks[12], weight: 1.0, name: 'right_shoulder' },  // 右肩
            { point: landmarks[23], weight: 0.8, name: 'left_hip' },  // 左腰
            { point: landmarks[24], weight: 0.8, name: 'right_hip' },  // 右腰
            { point: landmarks[13], weight: 0.5, name: 'left_elbow' },  // 左肘
            { point: landmarks[14], weight: 0.5, name: 'right_elbow' },  // 右肘
            { point: landmarks[15], weight: 0.3, name: 'left_wrist' },  // 左手首
            { point: landmarks[16], weight: 0.3, name: 'right_wrist' }   // 右手首
        ];

        // 重み付き可視性スコアの計算
        let weightedScore = 0;
        let totalWeight = 0;
        let visibleCount = 0;
        let debugInfo = [];

        weightedKeyPoints.forEach(item => {
            if (item.point && item.point.visibility) {
                if (item.point.visibility > 0.3) {  // 検出しやすくするため緩和
                    weightedScore += item.point.visibility * item.weight;
                    visibleCount++;
                    debugInfo.push(`${item.name}:${item.point.visibility.toFixed(2)}`);
                }
                totalWeight += item.weight;
            }
        });

        console.log(`[DEBUG] 可視キーポイント: ${visibleCount}/9個 [${debugInfo.join(', ')}]`);

        // 最低限必要なキーポイント数を緩和
        if (visibleCount < 3) {
            console.log('[DEBUG] ❌ キーポイント不足（3個未満）でキャプチャ拒否');
            return 0;
        }

        // 人体構造の妥当性をチェック
        const structureValid = this.validatePoseStructure(landmarks);
        console.log(`[DEBUG] 構造妥当性: ${structureValid}`);

        if (!structureValid) {
            // 構造が無効な場合、信頼度を下げるが完全に0にはしない
            weightedScore *= 0.7;
            console.log('[DEBUG] ⚠️ 構造妥当性チェック失敗 - 信頼度を70%に調整');
        }

        // 時系列一貫性チェック（より緩和された閾値）
        const temporalConsistency = this.checkTemporalConsistency(landmarks);
        if (temporalConsistency < 0.5) {
            weightedScore *= temporalConsistency;
            console.log(`[DEBUG] ⚠️ 時系列一貫性低下 - 信頼度を${(temporalConsistency * 100).toFixed(0)}%に調整`);
        }

        // 最終信頼度の計算
        const confidence = totalWeight > 0 ? weightedScore / totalWeight : 0;

        console.log(`[DEBUG] 📊 最終信頼度: ${confidence.toFixed(3)}`);
        return confidence;
    }

    validateLandmarksInPersonRegion(landmarks, segmentationMask) {
        try {
            if (!segmentationMask || !landmarks) {
                console.log('[DEBUG] セグメンテーションマスクまたはランドマークが不正');
                return false;
            }

            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            canvas.width = segmentationMask.width;
            canvas.height = segmentationMask.height;

            // セグメンテーションマスクを描画
            const imageData = ctx.createImageData(canvas.width, canvas.height);
            imageData.data.set(segmentationMask.data);
            ctx.putImageData(imageData, 0, 0);

            // 主要キーポイント周辺の人物ピクセル率をチェック
            const keyPoints = [
                landmarks[0],  // nose
                landmarks[11], // left shoulder
                landmarks[12], // right shoulder
                landmarks[23], // left hip
                landmarks[24]  // right hip
            ];

            let totalPersonPixels = 0;
            let totalPixels = 0;
            const checkRadius = 20; // 各キーポイント周辺20ピクセルをチェック

            keyPoints.forEach(point => {
                if (point && point.visibility > 0.5) {
                    const x = Math.floor(point.x * canvas.width);
                    const y = Math.floor(point.y * canvas.height);

                    // キーポイント周辺のピクセルをサンプリング
                    for (let dx = -checkRadius; dx <= checkRadius; dx += 5) {
                        for (let dy = -checkRadius; dy <= checkRadius; dy += 5) {
                            const checkX = x + dx;
                            const checkY = y + dy;

                            if (checkX >= 0 && checkX < canvas.width &&
                                checkY >= 0 && checkY < canvas.height) {
                                const pixelData = ctx.getImageData(checkX, checkY, 1, 1).data;
                                const alpha = pixelData[3]; // アルファチャンネルで人物判定

                                totalPixels++;
                                if (alpha > 128) { // 人物領域の閾値
                                    totalPersonPixels++;
                                }
                            }
                        }
                    }
                }
            });

            const personPixelRatio = totalPixels > 0 ? totalPersonPixels / totalPixels : 0;
            const PERSON_REGION_THRESHOLD = 0.3; // 30%以上が人物ピクセルである必要

            console.log(`[DEBUG] 人物ピクセル率: ${(personPixelRatio * 100).toFixed(1)}% (閾値: ${PERSON_REGION_THRESHOLD * 100}%)`);

            return personPixelRatio >= PERSON_REGION_THRESHOLD;

        } catch (error) {
            console.warn('背景セグメンテーション検証中にエラーが発生しました:', error);
            return true; // エラー時は通す（後方互換性）
        }
    }

    validateTemporalConsistency(currentLandmarks) {
        try {
            if (!this.previousLandmarks) {
                // 初回は通す
                this.previousLandmarks = currentLandmarks;
                return true;
            }

            // 主要キーポイントの平均移動量を計算
            const keyPoints = [0, 11, 12, 23, 24]; // nose, shoulders, hips
            let totalMovement = 0;
            let validPoints = 0;

            keyPoints.forEach(index => {
                const current = currentLandmarks[index];
                const previous = this.previousLandmarks[index];

                if (current && previous && current.visibility > 0.5 && previous.visibility > 0.5) {
                    const dx = current.x - previous.x;
                    const dy = current.y - previous.y;
                    const movement = Math.sqrt(dx * dx + dy * dy);
                    totalMovement += movement;
                    validPoints++;
                }
            });

            const averageMovement = validPoints > 0 ? totalMovement / validPoints : 0;
            const isConsistent = averageMovement < this.MAX_MOVEMENT_THRESHOLD;

            console.log(`[DEBUG] 平均移動量: ${averageMovement.toFixed(3)}, 一貫性: ${isConsistent}`);

            // 前フレームの情報を更新
            this.previousLandmarks = currentLandmarks;

            return isConsistent;

        } catch (error) {
            console.warn('時系列一貫性チェック中にエラーが発生しました:', error);
            return true; // エラー時は通す
        }
    }

    validateConsecutiveDetections() {
        // 現在のフレームで検出があった場合の履歴管理
        this.detectionHistory.push(Date.now());

        // 古い履歴を削除（5秒以上前）
        const fiveSecondsAgo = Date.now() - 5000;
        this.detectionHistory = this.detectionHistory.filter(time => time > fiveSecondsAgo);

        // 直近の連続検出数をチェック
        const recentDetections = this.detectionHistory.slice(-this.REQUIRED_CONSECUTIVE_DETECTIONS);
        const hasConsecutiveDetections = recentDetections.length >= this.REQUIRED_CONSECUTIVE_DETECTIONS;

        console.log(`[DEBUG] 連続検出履歴: ${this.detectionHistory.length}, 必要数: ${this.REQUIRED_CONSECUTIVE_DETECTIONS}, 有効: ${hasConsecutiveDetections}`);

        return hasConsecutiveDetections;
    }

    validatePoseStructure(landmarks) {
        try {
            console.log('[DEBUG] 改善された構造妥当性チェック開始');

            // 主要なキーポイントの取得
            const nose = landmarks[0];
            const leftShoulder = landmarks[11];
            const rightShoulder = landmarks[12];
            const leftHip = landmarks[23];
            const rightHip = landmarks[24];
            const leftKnee = landmarks[25];
            const rightKnee = landmarks[26];

            // 必須キーポイントの存在と可視性チェック
            const requiredVisibility = 0.5;  // 実用的な閾値に緩和
            const criticalPoints = [nose, leftShoulder, rightShoulder, leftHip, rightHip];
            const validCriticalPoints = criticalPoints.filter(
                point => point && point.visibility >= requiredVisibility
            );

            console.log(`[DEBUG] 重要キーポイント: ${validCriticalPoints.length}/5個が閾値${requiredVisibility}以上`);

            // 最低3つの重要キーポイントが必要（緩和）
            if (validCriticalPoints.length < 3) {
                console.log('[DEBUG] ❌ 可視性チェック失敗: 重要キーポイント不足');
                return false;
            }

            // 必須キーポイントが存在しない場合はfalse
            if (!nose || !leftShoulder || !rightShoulder || !leftHip || !rightHip) {
                console.log('[DEBUG] ❌ 必須キーポイントが存在しません');
                return false;
            }

            // 新しい検証: 人体らしい関節角度チェック
            const leftElbow = landmarks[13];
            const rightElbow = landmarks[14];
            if (leftElbow && rightElbow) {
                // 肘角度の妥当性チェック（180度以上は不自然）
                const leftArmAngle = this.calculateJointAngle(leftShoulder, leftElbow, landmarks[15]);
                const rightArmAngle = this.calculateJointAngle(rightShoulder, rightElbow, landmarks[16]);

                if (leftArmAngle > 170 && rightArmAngle > 170) {
                    console.log('[DEBUG] 肘角度チェック失敗: 両腕が不自然に真っ直ぐ');
                    return false;
                }
            }

            // 肩の幅をチェック（より現実的な範囲に調整）
            const shoulderDistance = Math.abs(leftShoulder.x - rightShoulder.x);
            if (shoulderDistance < 0.05 || shoulderDistance > 0.8) { // カメラ距離を考慮して緩和
                console.log(`[DEBUG] ❌ 肩幅チェック失敗: ${shoulderDistance.toFixed(3)}`);
                return false;
            }

            // 腰の幅をチェック
            const hipDistance = Math.abs(leftHip.x - rightHip.x);
            if (hipDistance < 0.04 || hipDistance > 0.6) { // カメラ距離を考慮して緩和
                console.log(`[DEBUG] ❌ 腰幅チェック失敗: ${hipDistance.toFixed(3)}`);
                return false;
            }

            // 肩と腰の幅の比率チェック（人体の自然な比率）
            const shoulderHipRatio = shoulderDistance / hipDistance;
            if (shoulderHipRatio < 0.8 || shoulderHipRatio > 2.5) {
                console.log(`[DEBUG] ❌ 肩腰比率チェック失敗: ${shoulderHipRatio.toFixed(3)}`);
                return false;
            }

            // 胴体の長さをチェック（肩から腰まで）
            const torsoLength = Math.abs((leftShoulder.y + rightShoulder.y) / 2 - (leftHip.y + rightHip.y) / 2);
            if (torsoLength < 0.05 || torsoLength > 1.2) { // より柔軟な範囲に拡張
                console.log(`[DEBUG] ❌ 胴体長チェック失敗: ${torsoLength.toFixed(3)}`);
                return false;
            }

            // 頭の位置チェック（肩より上にあるか）
            const shoulderY = (leftShoulder.y + rightShoulder.y) / 2;
            if (nose.y > shoulderY - 0.02) { // 頭は肩より上にある
                console.log(`[DEBUG] ❌ 頭部位置チェック失敗: nose=${nose.y.toFixed(3)}, shoulder=${shoulderY.toFixed(3)}`);
                return false;
            }

            // 対称性チェック（左右の肩と腰の高さがある程度揃っているか）
            const shoulderSymmetry = Math.abs(leftShoulder.y - rightShoulder.y);
            const hipSymmetry = Math.abs(leftHip.y - rightHip.y);
            if (shoulderSymmetry > 0.15 || hipSymmetry > 0.15) { // 適切なマージン
                console.log(`[DEBUG] ❌ 対称性チェック失敗: 肩=${shoulderSymmetry.toFixed(3)}, 腰=${hipSymmetry.toFixed(3)}`);
                return false;
            }

            // 追加: 脚の長さチェック（膝が存在する場合）
            if (leftKnee && rightKnee) {
                const leftLegLength = Math.abs(leftHip.y - leftKnee.y);
                const rightLegLength = Math.abs(rightHip.y - rightKnee.y);
                const legRatio = Math.min(leftLegLength, rightLegLength) / Math.max(leftLegLength, rightLegLength);

                if (legRatio < 0.7) {  // 左右の脚の長さが大きく異なる場合
                    console.log(`[DEBUG] ❌ 脚の長さ比率チェック失敗: ${legRatio.toFixed(3)}`);
                    return false;
                }
            }

            // キーポイント密度チェック - 一時的に無効化（検出率を優先）
            // const boundingBox = this.calculateBoundingBox(landmarks);
            // const keypointDensity = visibleKeypoints.length / (boundingBox.width * boundingBox.height);
            // if (keypointDensity < 5) { // 密度閾値を緩和
            //     console.log(`[DEBUG] キーポイント密度チェック失敗: ${keypointDensity.toFixed(2)}`);
            //     return false;
            // }

            return true;
        } catch (error) {
            console.warn('ポーズ構造の検証中にエラーが発生しました:', error);
            return false;
        }
    }

    // 関節角度を計算するヘルパー関数
    calculateJointAngle(point1, joint, point2) {
        if (!point1 || !joint || !point2) return 0;

        const vector1 = { x: point1.x - joint.x, y: point1.y - joint.y };
        const vector2 = { x: point2.x - joint.x, y: point2.y - joint.y };

        const dot = vector1.x * vector2.x + vector1.y * vector2.y;
        const mag1 = Math.sqrt(vector1.x * vector1.x + vector1.y * vector1.y);
        const mag2 = Math.sqrt(vector2.x * vector2.x + vector2.y * vector2.y);

        const cosAngle = dot / (mag1 * mag2);
        return Math.acos(Math.max(-1, Math.min(1, cosAngle))) * 180 / Math.PI;
    }

    // 時系列一貫性をチェック
    checkTemporalConsistency(currentLandmarks) {
        if (!this.previousLandmarks) {
            this.previousLandmarks = currentLandmarks;
            return 1.0;  // 初回は最大の一貫性を返す
        }

        let totalMovement = 0;
        let validPoints = 0;

        // 主要ランドマークの動きをチェック
        const keyPoints = [0, 11, 12, 13, 14, 15, 16, 23, 24];  // 重要なキーポイント

        for (const index of keyPoints) {
            const current = currentLandmarks[index];
            const previous = this.previousLandmarks[index];

            if (current && previous && current.visibility > 0.5 && previous.visibility > 0.5) {
                const movement = Math.sqrt(
                    Math.pow(current.x - previous.x, 2) +
                    Math.pow(current.y - previous.y, 2)
                );
                totalMovement += movement;
                validPoints++;
            }
        }

        // 前フレームとの平滑化
        for (let i = 0; i < currentLandmarks.length; i++) {
            if (currentLandmarks[i] && this.previousLandmarks[i]) {
                currentLandmarks[i].x = this.smoothingFactor * currentLandmarks[i].x +
                                        (1 - this.smoothingFactor) * this.previousLandmarks[i].x;
                currentLandmarks[i].y = this.smoothingFactor * currentLandmarks[i].y +
                                        (1 - this.smoothingFactor) * this.previousLandmarks[i].y;
            }
        }

        this.previousLandmarks = currentLandmarks;

        if (validPoints === 0) return 1.0;

        const avgMovement = totalMovement / validPoints;

        // 動きが大きすぎる場合は一貫性が低い
        if (avgMovement > this.MAX_MOVEMENT_THRESHOLD) {
            console.log(`[DEBUG] 時系列一貫性低下: 平均移動量 ${avgMovement.toFixed(3)}`);
            return 0.5;  // 一貫性が低い
        }

        // 動きが自然な範囲内なら高い一貫性
        const consistency = Math.max(0.6, 1.0 - (avgMovement / this.MAX_MOVEMENT_THRESHOLD));
        return consistency;
    }

    // バウンディングボックスを計算するヘルパー関数
    calculateBoundingBox(landmarks) {
        const visibleLandmarks = landmarks.filter(landmark => landmark && landmark.visibility > 0.5);
        if (visibleLandmarks.length === 0) return { width: 0, height: 0 };

        const xCoords = visibleLandmarks.map(landmark => landmark.x);
        const yCoords = visibleLandmarks.map(landmark => landmark.y);

        const minX = Math.min(...xCoords);
        const maxX = Math.max(...xCoords);
        const minY = Math.min(...yCoords);
        const maxY = Math.max(...yCoords);

        return {
            width: maxX - minX,
            height: maxY - minY,
            minX, maxX, minY, maxY
        };
    }

    drawPoseOverlay(results) {
        const landmarks = results.poseLandmarks;

        this.overlayCtx.save();
        this.overlayCtx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);

        // 骨格線を描画
        this.overlayCtx.strokeStyle = this.SKELETON_COLOR;
        this.overlayCtx.lineWidth = 2;

        this.POSE_CONNECTIONS.forEach(([start, end]) => {
            const startPoint = landmarks[start];
            const endPoint = landmarks[end];

            if (startPoint && endPoint) {
                this.overlayCtx.beginPath();
                this.overlayCtx.moveTo(
                    startPoint.x * this.overlayCanvas.width,
                    startPoint.y * this.overlayCanvas.height
                );
                this.overlayCtx.lineTo(
                    endPoint.x * this.overlayCanvas.width,
                    endPoint.y * this.overlayCanvas.height
                );
                this.overlayCtx.stroke();
            }
        });

        // キーポイントを描画
        this.overlayCtx.fillStyle = this.KEYPOINT_COLOR;
        landmarks.forEach(landmark => {
            if (landmark.visibility > 0.5) {
                this.overlayCtx.beginPath();
                this.overlayCtx.arc(
                    landmark.x * this.overlayCanvas.width,
                    landmark.y * this.overlayCanvas.height,
                    5, 0, 2 * Math.PI
                );
                this.overlayCtx.fill();
            }
        });

        this.overlayCtx.restore();
    }

    onPersonDetected(confidence) {
        const now = Date.now();
        const intervalMs = parseInt(this.captureInterval.value) * 1000;
        const timeSinceLastCapture = now - this.lastCaptureTime;

        console.log(`[DEBUG] onPersonDetected呼び出し - 信頼度: ${confidence.toFixed(3)}`);
        console.log(`[DEBUG] 自動キャプチャ: ${this.autoCapture.checked}, 最後のキャプチャからの経過時間: ${timeSinceLastCapture}ms, 必要間隔: ${intervalMs}ms`);

        if (this.autoCapture.checked && timeSinceLastCapture > intervalMs) {
            console.log(`[DEBUG] ✅ キャプチャ実行！`);
            this.captureImage(confidence);
            this.lastCaptureTime = now;
            // 連続検出カウントをリセット（キャプチャ後は再度検出が必要）
            this.consecutiveDetectionCount = 0;
        } else if (!this.autoCapture.checked) {
            console.log(`[DEBUG] ⚠️ 自動キャプチャが無効`);
        } else {
            console.log(`[DEBUG] ⏳ キャプチャ間隔待機中（あと${intervalMs - timeSinceLastCapture}ms）`);
        }
    }

    captureImage(confidence) {
        // キャンバスに現在のビデオフレームを描画
        this.ctx.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);

        // 画像データを取得
        this.canvas.toBlob((blob) => {
            const timestamp = new Date().toLocaleString('ja-JP');
            const filename = `person_${Date.now()}.jpg`;

            // 画像をギャラリーに追加
            this.addToGallery(blob, timestamp, filename, confidence);

            // キャプチャカウントを更新
            this.captureCount++;
            this.captureCountEl.textContent = `キャプチャ: ${this.captureCount}`;

            this.showNotification(`人物を検出しました (信頼度: ${(confidence * 100).toFixed(1)}%)`);
        }, 'image/jpeg', 0.9);
    }

    addToGallery(blob, timestamp, filename, confidence) {
        const url = URL.createObjectURL(blob);
        const itemId = `item-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        const galleryItem = document.createElement('div');
        galleryItem.className = 'gallery-item';
        galleryItem.dataset.itemId = itemId;
        galleryItem.dataset.url = url;
        galleryItem.dataset.filename = filename;

        galleryItem.innerHTML = `
            <div class="selection-checkbox"></div>
            <img src="${url}" alt="Captured person">
            <div class="timestamp">${timestamp}</div>
            <div class="item-controls">
                <button class="item-btn download-btn" title="ダウンロード">
                    <i class="fas fa-download"></i>
                </button>
                <button class="item-btn delete-btn" title="削除">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        `;

        // クリックで選択/選択解除
        galleryItem.addEventListener('click', (e) => {
            if (!e.target.closest('.item-controls')) {
                this.toggleImageSelection(itemId, galleryItem);
            }
        });

        // ダウンロードボタン
        const downloadBtn = galleryItem.querySelector('.download-btn');
        downloadBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.downloadImage(url, filename);
        });

        // 削除ボタン
        const deleteBtn = galleryItem.querySelector('.delete-btn');
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.deleteImage(itemId, galleryItem);
        });

        this.gallery.insertBefore(galleryItem, this.gallery.firstChild);

        // 最大表示数を超えた場合、古い画像を削除
        while (this.gallery.children.length > this.MAX_GALLERY_ITEMS) {
            const lastChild = this.gallery.lastChild;
            const itemId = lastChild.dataset.itemId;
            this.selectedImages.delete(itemId);
            const img = lastChild.querySelector('img');
            if (img && img.src) {
                URL.revokeObjectURL(img.src);
            }
            this.gallery.removeChild(lastChild);
        }

        this.updateGalleryControls();
    }

    downloadImage(url, filename) {
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

        this.showNotification('画像を保存しました');
    }

    clearOverlay() {
        this.overlayCtx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);
    }

    showNotification(message, type = 'success') {
        this.notification.textContent = message;
        this.notification.style.background = type === 'error' ?
            'var(--danger-color)' : 'var(--success-color)';

        this.notification.classList.add('show');

        setTimeout(() => {
            this.notification.classList.remove('show');
        }, 3000);
    }

    setupKeyboardShortcuts() {
        let keysPressed = [];

        document.addEventListener('keydown', (e) => {
            keysPressed.push(e.key.toLowerCase());
            keysPressed = keysPressed.slice(-4); // 最後の4文字を保持

            // docsと入力: ドキュメントを開く
            if (keysPressed.join('') === 'docs') {
                e.preventDefault();
                this.openDocumentation();
                keysPressed = [];
            }

            // Cキー: カメラの開始/停止
            if (e.key.toLowerCase() === 'c' && !e.ctrlKey && !e.altKey && !e.metaKey) {
                e.preventDefault();
                if (this.stream) {
                    this.stopCamera();
                } else {
                    this.startCamera();
                }
            }

            // スペースキー: 検出の開始/停止
            if (e.key === ' ' && !e.ctrlKey && !e.altKey && !e.metaKey) {
                e.preventDefault();
                if (this.stream && !this.toggleDetectionBtn.disabled) {
                    this.toggleDetection();
                }
            }

            // Sキー: 手動キャプチャ
            if (e.key.toLowerCase() === 's' && !e.ctrlKey && !e.altKey && !e.metaKey) {
                e.preventDefault();
                if (this.stream && this.isDetecting) {
                    this.captureImage(1.0); // 手動キャプチャは信頼度100%として扱う
                    this.showNotification('手動キャプチャを実行しました');
                }
            }

            // ?キー: ヘルプ表示
            if (e.key === '?' || (e.shiftKey && e.key === '/')) {
                e.preventDefault();
                this.showHelp();
            }
        });
    }

    openDocumentation() {
        // 新しいウィンドウでドキュメントを開く
        const docsWindow = window.open('docs.html', 'docs', 'width=1200,height=800');
        if (!docsWindow) {
            this.showNotification('ドキュメントを開けませんでした。ポップアップブロックを確認してください。', 'error');
        }
    }

    showHelp() {
        const helpMessage = `
キーボードショートカット:
[docs] - ドキュメントを開く（d,o,c,sと順に入力）
[C] - カメラ開始/停止
[Space] - 検出開始/停止
[S] - 手動キャプチャ
[?] - このヘルプを表示

信頼度調整のヒント:
検出されない場合は信頼度を0.3〜0.5に調整してください`;

        alert(helpMessage);
    }

    // 画像選択/選択解除
    toggleImageSelection(itemId, element) {
        if (this.selectedImages.has(itemId)) {
            this.selectedImages.delete(itemId);
            element.classList.remove('selected');
        } else {
            this.selectedImages.add(itemId);
            element.classList.add('selected');
        }
        this.updateGalleryControls();
    }

    // 全選択
    selectAllImages() {
        const items = this.gallery.querySelectorAll('.gallery-item');
        items.forEach(item => {
            const itemId = item.dataset.itemId;
            this.selectedImages.add(itemId);
            item.classList.add('selected');
        });
        this.updateGalleryControls();
    }

    // 選択解除
    deselectAllImages() {
        this.selectedImages.clear();
        this.gallery.querySelectorAll('.gallery-item').forEach(item => {
            item.classList.remove('selected');
        });
        this.updateGalleryControls();
    }

    // 一括ダウンロード
    downloadAllImages() {
        const items = this.gallery.querySelectorAll('.gallery-item');
        if (items.length === 0) {
            this.showNotification('ダウンロードする画像がありません', 'error');
            return;
        }

        // ZIPライブラリがないため、個別ダウンロード
        items.forEach((item, index) => {
            setTimeout(() => {
                this.downloadImage(item.dataset.url, item.dataset.filename);
            }, index * 500); // 0.5秒間隔でダウンロード
        });

        this.showNotification(`${items.length}枚の画像を一括ダウンロード中...`);
    }

    // 選択した画像を削除
    deleteSelectedImages() {
        if (this.selectedImages.size === 0) {
            this.showNotification('削除する画像が選択されていません', 'error');
            return;
        }

        if (confirm(`選択した${this.selectedImages.size}枚の画像を削除しますか？`)) {
            this.selectedImages.forEach(itemId => {
                const item = this.gallery.querySelector(`[data-item-id="${itemId}"]`);
                if (item) {
                    this.deleteImage(itemId, item);
                }
            });
            this.selectedImages.clear();
            this.updateGalleryControls();
        }
    }

    // 全画像を削除
    clearAllImages() {
        const items = this.gallery.querySelectorAll('.gallery-item');
        if (items.length === 0) {
            this.showNotification('削除する画像がありません', 'error');
            return;
        }

        if (confirm(`すべての画像（${items.length}枚）を削除しますか？`)) {
            items.forEach(item => {
                const itemId = item.dataset.itemId;
                this.deleteImage(itemId, item);
            });
            this.selectedImages.clear();
            this.updateGalleryControls();
        }
    }

    // 個別画像削除
    deleteImage(itemId, element) {
        const url = element.dataset.url;
        if (url) {
            URL.revokeObjectURL(url);
        }
        this.selectedImages.delete(itemId);
        element.remove();
        this.updateGalleryControls();
        this.showNotification('画像を削除しました');
    }

    // ギャラリーコントロールの更新
    updateGalleryControls() {
        const totalItems = this.gallery.children.length;
        const selectedCount = this.selectedImages.size;

        // 選択状態によるボタン表示制御
        if (selectedCount > 0) {
            this.selectAllBtn.style.display = 'none';
            this.deselectAllBtn.style.display = 'inline-block';
            this.deleteSelectedBtn.style.display = 'inline-block';
            this.deleteSelectedBtn.innerHTML = `<i class="fas fa-trash"></i> 選択削除 (${selectedCount})`;
        } else {
            this.selectAllBtn.style.display = 'inline-block';
            this.deselectAllBtn.style.display = 'none';
            this.deleteSelectedBtn.style.display = 'none';
        }

        // 全選択ボタンの状態更新
        if (totalItems > 0 && selectedCount === totalItems) {
            this.selectAllBtn.style.display = 'none';
            this.deselectAllBtn.style.display = 'inline-block';
        }
    }

    initializeStrictMode() {
        console.log('厳格検出モードで初期化');

        // 厳格検出モードの設定（実用的な閾値に調整）
        this.currentConfidenceThreshold = 0.5;
        this.REQUIRED_CONSECUTIVE_DETECTIONS = 3;
        this.pose.setOptions({
            minDetectionConfidence: 0.6,
            minTrackingConfidence: 0.6,
            modelComplexity: 2
        });

        this.showNotification('🔴 厳格検出モード: 最高精度・誤検出を最小限に', 'info');

        // 連続検出カウントをリセット
        this.consecutiveDetectionCount = 0;
    }
}

// アプリケーションの初期化
document.addEventListener('DOMContentLoaded', () => {
    window.app = new PersonDetectionApp();
});