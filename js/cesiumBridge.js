/**
 * cesiumBridge.js — Cesium.js 互操作桥接模块
 * 负责 Cesium Viewer 初始化、卫星实体创建/更新/移除、场景时间控制
 * 通过 window.cesiumBridge 暴露接口供 Blazor IJSRuntime 调用
 */

// 使用全局变量命名空间模式，避免污染全局作用域
window.cesiumBridge = (function () {
    // ==================== 私有状态 ====================

    /** Cesium.Viewer 实例 */
    let viewer = null;

    /** 卫星记录字典：key=NORAD编号, value={ satrec, entity, displayName, line1, line2 } */
    const satellites = {};

    /** Cesium Viewer 默认配置 */
    const DEFAULT_VIEWER_OPTIONS = {
        animation: false,      // 关闭底部动画控件
        timeline: true,        // 显示底部时间轴
        baseLayerPicker: false,// 关闭底图选择器
        fullscreenButton: false, // 关闭全屏按钮
        homeButton: false,     // 关闭 Home 按钮
        sceneModePicker: false,// 关闭场景模式选择器
        navigationHelpButton: false, // 关闭导航帮助按钮
        geocoder: false,       // 关闭地名搜索
        infoBox: false         // 关闭信息框
    };

    // ==================== 公共方法 ====================

    /**
     * 初始化 Cesium Viewer
     * @param {string} containerId - DOM 容器元素的 ID
     */
    function initViewer(containerId) {
        if (viewer) {
            console.warn('Cesium Viewer 已存在，跳过重复初始化');
            return;
        }

        // Cesium Ion 访问令牌
        Cesium.Ion.defaultAccessToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiJhMTQzYWQ5ZS05ZWVlLTRiMjgtYTlmOS02NWZhNDkwMmNkMjIiLCJpZCI6NDM5NDczLCJpc3MiOiJodHRwczovL2FwaS5jZXNpdW0uY29tIiwiYXVkIjoidW5kZWZpbmVkX2RlZmF1bHQiLCJpYXQiOjE3ODA0MTEwOTd9.bCAKi7GvjzwPWzR-cvWONr7MO5zJkzY0aLN7WlMK-V4';

        // 设置 Cesium 本地资源根路径
        Cesium.buildModuleUrl.setBaseUrl('./lib/cesium/');

        // 使用 Cesium Ion 默认底图和地形（Bing Maps + Cesium World Terrain）
        const options = Object.assign({}, DEFAULT_VIEWER_OPTIONS);

        viewer = new Cesium.Viewer(containerId, options);

        // 诊断：检查底部时间轴 DOM 元素状态
        setTimeout(function () {
            viewer.resize();
            const container = document.getElementById(containerId);
            const bottomEl = container.querySelector('.cesium-viewer-bottom');
            const timelineEl = container.querySelector('.cesium-viewer-timelineContainer');
            const viewerEl = container.querySelector('.cesium-viewer');
            const widgetEl = container.querySelector('.cesium-viewer-cesiumWidgetContainer');
            const widgetInner = container.querySelector('.cesium-widget');
            
            const vpHeight = window.innerHeight;
            const containerRect = container.getBoundingClientRect();
            const viewerRect = viewerEl ? viewerEl.getBoundingClientRect() : null;
            const widgetRect = widgetEl ? widgetEl.getBoundingClientRect() : null;
            const tRect = timelineEl ? timelineEl.getBoundingClientRect() : null;
            const bRect = bottomEl ? bottomEl.getBoundingClientRect() : null;
            
            console.log('=== Cesium 布局诊断 ===');
            console.log('视口高度:', vpHeight + 'px');
            console.log('cesiumContainer rect:', JSON.stringify({top:containerRect.top, bottom:containerRect.bottom, height:containerRect.height}));
            console.log('cesium-viewer rect:', viewerRect ? JSON.stringify({top:viewerRect.top, bottom:viewerRect.bottom, height:viewerRect.height}) : '不存在');
            console.log('cesiumWidgetContainer rect:', widgetRect ? JSON.stringify({top:widgetRect.top, bottom:widgetRect.bottom, height:widgetRect.height}) : '不存在');
            console.log('timeline rect:', tRect ? JSON.stringify({top:tRect.top, bottom:tRect.bottom, height:tRect.height}) : '不存在');
            console.log('bottomContainer rect:', bRect ? JSON.stringify({top:bRect.top, bottom:bRect.bottom, height:bRect.height}) : '不存在');
            console.log('timeline 是否在视口内:', tRect ? (tRect.bottom <= vpHeight && tRect.top >= 0 ? '是' : '否') : '元素不存在');
            
            // 如果 timeline 底部超出视口，说明被裁剪了
            if (tRect && tRect.bottom > vpHeight + 2) {
                console.warn('时间轴底部超出视口 ' + (tRect.bottom - vpHeight) + 'px');
            }
        }, 500);

        // 设置场景时钟：默认使用实时模式
        viewer.clock.shouldAnimate = false; // 默认不自动播放（由用户控制）

        console.log('Cesium Viewer 初始化完成（Ion Token + 默认底图地形）');
    }

    /**
     * 添加卫星到场景（解析 TLE 并创建 entity）
     * @param {string} noradId - NORAD 卫星编号（唯一标识）
     * @param {string} line1 - TLE 第 1 行根数
     * @param {string} line2 - TLE 第 2 行根数
     * @param {string} displayName - 卫星显示名称
     */
    function addSatellite(noradId, line1, line2, displayName) {
        if (!viewer) {
            console.error('Cesium Viewer 未初始化');
            return;
        }

        // 如果同名卫星已存在，先移除旧的
        if (satellites[noradId]) {
            removeSatellite(noradId);
        }

        try {
            // 解析 TLE 获取 satrec 对象（用于后续轨道递推）
            const satrec = satellite.twoline2satrec(line1, line2);

            // 创建 Cesium entity（初始位置用 TLE 历元时刻递推）
            const epochDate = getEpochFromTLE(line1);
            const position = orbitPropagator.propagate(line1, line2, epochDate);

            let initialPosition;
            if (position) {
                // 将地理坐标转换为 Cesium Cartesian3 位置
                initialPosition = Cesium.Cartesian3.fromDegrees(
                    position.longitude,
                    position.latitude,
                    position.height * 1000 // 千米 → 米
                );
            } else {
                // 如果递推失败，使用默认位置（0,0,0）
                initialPosition = Cesium.Cartesian3.fromDegrees(0, 0, 0);
            }

            // 创建卫星点位 entity
            const entity = viewer.entities.add({
                position: initialPosition,
                point: {
                    pixelSize: 8,
                    color: Cesium.Color.fromCssColorString('#FF4444'),
                    outlineColor: Cesium.Color.WHITE,
                    outlineWidth: 1
                },
                label: {
                    text: displayName,
                    font: '12px sans-serif',
                    fillColor: Cesium.Color.WHITE,
                    outlineColor: Cesium.Color.BLACK,
                    outlineWidth: 2,
                    verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                    pixelOffset: new Cesium.Cartesian2(0, -12)
                }
            });

            // 存储卫星记录
            satellites[noradId] = {
                satrec: satrec,
                entity: entity,
                displayName: displayName,
                line1: line1,
                line2: line2
            };

            console.log(`卫星已添加: ${displayName} (NORAD ${noradId})`);
        } catch (error) {
            console.error(`添加卫星失败: ${displayName}`, error);
        }
    }

    /**
     * 从场景中移除指定卫星
     * @param {string} noradId - NORAD 卫星编号
     */
    function removeSatellite(noradId) {
        if (!viewer || !satellites[noradId]) return;

        viewer.entities.remove(satellites[noradId].entity);
        delete satellites[noradId];
        console.log(`卫星已移除: NORAD ${noradId}`);
    }

    /**
     * 清除场景中所有卫星
     */
    function removeAllSatellites() {
        if (!viewer) return;

        Object.keys(satellites).forEach(function (noradId) {
            viewer.entities.remove(satellites[noradId].entity);
            delete satellites[noradId];
        });

        console.log('所有卫星已清除');
    }

    /**
     * 更新所有卫星到当前场景时间的位置
     * 根据 viewer.clock.currentTime 对所有已注册卫星进行轨道递推
     */
    function updateAllSatellitePositions() {
        if (!viewer) return;

        // 获取场景当前时间（JulianDate → JavaScript Date）
        const currentJulian = viewer.clock.currentTime;
        const currentDate = Cesium.JulianDate.toDate(currentJulian);

        Object.keys(satellites).forEach(function (noradId) {
            updateSatellitePosition(noradId, currentDate);
        });
    }

    /**
     * 更新单颗卫星的位置
     * @param {string} noradId - NORAD 卫星编号
     * @param {Date} date - 目标时刻
     */
    function updateSatellitePosition(noradId, date) {
        const record = satellites[noradId];
        if (!record) return;

        // 使用 orbitPropagator 进行轨道递推
        const position = orbitPropagator.propagate(record.line1, record.line2, date);

        if (position) {
            // 更新 entity 的 position 属性
            record.entity.position = Cesium.Cartesian3.fromDegrees(
                position.longitude,
                position.latitude,
                position.height * 1000 // 千米 → 米
            );
        }
    }

    /**
     * 设置 Cesium 场景时钟时间
     * @param {string} isoTimeString - ISO 8601 格式的时间字符串（如 "2024-06-01T12:00:00.000Z"）
     */
    function setSceneTime(isoTimeString) {
        if (!viewer) return;

        const date = new Date(isoTimeString);
        const julianDate = Cesium.JulianDate.fromDate(date);

        // 设置当前时间
        viewer.clock.currentTime = julianDate;

        // 自动更新所有卫星位置到新时间
        updateSatellitePositionsForDate(date);

        console.log(`场景时间已设置: ${isoTimeString}`);
    }

    /**
     * 内部方法：更新所有卫星到指定日期的位置
     * @param {Date} date - 目标日期
     */
    function updateSatellitePositionsForDate(date) {
        Object.keys(satellites).forEach(function (noradId) {
            updateSatellitePosition(noradId, date);
        });
    }

    /**
     * 获取 Cesium 场景当前时间（ISO 8601 字符串）
     * @returns {string} ISO 8601 格式的时间字符串
     */
    function getSceneTime() {
        if (!viewer) return new Date().toISOString();

        const currentJulian = viewer.clock.currentTime;
        const currentDate = Cesium.JulianDate.toDate(currentJulian);
        return currentDate.toISOString();
    }

    /**
     * 获取卫星当前场景时间的位置
     * @param {string} noradId - NORAD 卫星编号
     * @returns {{ longitude: number, latitude: number, height: number } | null}
     */
    function getSatellitePosition(noradId) {
        if (!viewer || !satellites[noradId]) return null;

        const currentJulian = viewer.clock.currentTime;
        const currentDate = Cesium.JulianDate.toDate(currentJulian);

        return orbitPropagator.propagate(
            satellites[noradId].line1,
            satellites[noradId].line2,
            currentDate
        );
    }

    /**
     * 获取已注册的卫星 NORAD 编号列表
     * @returns {string[]}
     */
    function getRegisteredSatelliteIds() {
        return Object.keys(satellites);
    }

    // ==================== 内部辅助函数 ====================

    /**
     * 从 TLE 第一行中提取历元时间，返回 JavaScript Date 对象
     * TLE 历元格式：第 19-32 列为 YYDDD.DDDDDDDD（如 24153.54872222 = 2024年第153天 13:10:09）
     * @param {string} tleLine1 - TLE 第 1 行
     * @returns {Date} 历元对应的 Date 对象
     */
    function getEpochFromTLE(tleLine1) {
        // 提取历元字符串（列 19-32，即索引 18-31）
        const epochStr = tleLine1.substring(18, 32).trim();
        const year = parseInt(epochStr.substring(0, 2)) + 2000; // 两位年份 → 四位数
        const dayOfYear = parseFloat(epochStr.substring(2));     // 年积日（含小数部分）

        // 计算该年第 1 天的 Date
        const jan1 = new Date(Date.UTC(year, 0, 1));
        // 加上积日（减 1 是因为 jan1 已经是第 1 天）
        const epochDate = new Date(jan1.getTime() + (dayOfYear - 1) * 86400000);

        return epochDate;
    }

    // ==================== 公开 API ====================

    /**
     * 检查 Cesium Viewer 是否已初始化
     * @returns {boolean}
     */
    function isViewerReady() {
        return viewer !== null;
    }

    return {
        initViewer: initViewer,
        isViewerReady: isViewerReady,
        addSatellite: addSatellite,
        removeSatellite: removeSatellite,
        removeAllSatellites: removeAllSatellites,
        updateAllSatellitePositions: updateAllSatellitePositions,
        setSceneTime: setSceneTime,
        getSceneTime: getSceneTime,
        getSatellitePosition: getSatellitePosition,
        getRegisteredSatelliteIds: getRegisteredSatelliteIds
    };
})();
