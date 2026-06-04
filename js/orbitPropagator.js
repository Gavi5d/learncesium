/**
 * orbitPropagator.js — 轨道递推模块
 * 封装 satellite.js，提供 TLE → 地理坐标的纯计算功能
 * 不依赖 Cesium.js，可独立测试
 */

// 使用全局 satellite 命名空间（通过 CDN script 标签引入）
// satellite.js 提供的核心 API：
//   satellite.twoline2satrec(line1, line2) → satrec 对象
//   satellite.propagate(satrec, date)      → { position: ECI, velocity: ECI }
//   satellite.gstime(date)                 → 格林尼治恒星时（弧度）
//   satellite.eciToGeodetic(position, gmst) → { longitude, latitude, height }
//   satellite.degreesLong(rad)             → 经度（度，-180~180）
//   satellite.degreesLat(rad)              → 纬度（度，-90~90）

const orbitPropagator = (function () {
    /**
     * 根据 TLE 数据递推卫星在指定时刻的位置
     * @param {string} tleLine1 - TLE 第 1 行根数
     * @param {string} tleLine2 - TLE 第 2 行根数
     * @param {Date} date - 目标时刻（JavaScript Date 对象）
     * @returns {{ longitude: number, latitude: number, height: number } | null}
     *          地理坐标：经度（度）、纬度（度）、高度（千米），失败返回 null
     */
    function propagate(tleLine1, tleLine2, date) {
        try {
            // 步骤1：解析 TLE 行，创建 satrec 轨道记录对象
            const satrec = satellite.twoline2satrec(tleLine1, tleLine2);

            // 步骤2：将卫星轨道递推到目标时刻，获取 ECI 坐标系下的位置和速度
            const positionAndVelocity = satellite.propagate(satrec, date);

            // 如果 propagation 返回错误状态（如时间超出 TLE 有效范围）
            if (!positionAndVelocity || !positionAndVelocity.position) {
                console.warn('轨道递推失败：卫星可能已陨落或时间超出有效范围');
                return null;
            }

            // 步骤3：计算格林尼治恒星时，用于 ECI → ECEF 转换
            const gmst = satellite.gstime(date);

            // 步骤4：将 ECI 位置转换为地理坐标（经度、纬度、高度）
            const geodetic = satellite.eciToGeodetic(positionAndVelocity.position, gmst);

            // 步骤5：将弧度转换为角度，返回结果
            return {
                longitude: satellite.degreesLong(geodetic.longitude), // 经度（度）
                latitude: satellite.degreesLat(geodetic.latitude),   // 纬度（度）
                height: geodetic.height // 高度（千米，相对于地球椭球体表面）
            };
        } catch (error) {
            console.error('轨道递推计算异常:', error);
            return null;
        }
    }

    // 公开 API
    return {
        propagate: propagate
    };
})();
