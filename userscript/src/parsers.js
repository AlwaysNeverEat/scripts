// ─────────────────────────────────────────────────────────────────────────────
// Парсеры машины из URL сайтов подбора (Mann Filter, LYNXauto).
// Используются калькулятором и нотификатором «эта машина уже рассчитана».
// Только location — без DOM и GM_*.
// ─────────────────────────────────────────────────────────────────────────────

export function parseMannUrl() {
    if (location.hostname.includes('lynxauto.info')) {
        return parseLynxUrl();
    }

    const p = new URLSearchParams(location.search);
    if (!p.get('vehicleMake') && !p.get('vehicleModel')) return null;
    const make  = (p.get('vehicleMake')  || '').trim();
    const model = (p.get('vehicleModel') || '').replace(/\+/g, ' ').trim();
    const engineCode = (p.get('engineCode') || '').replace(/\+/g, ' ').trim();
    const fuelType = (p.get('fuelType') || '').trim();
    const ccm = parseInt(p.get('ccm') || '0') || null;
    const kw  = parseInt(p.get('kw')  || '0') || null;
    const bhp = parseInt(p.get('bhp') || '0') || null;
    const yMatch = (p.get('vehicleManufacturedFrom') || '').match(/(\d{4})/);
    const yearFrom = yMatch ? parseInt(yMatch[1]) : null;

    const makeShort = make.split(/\s+/)[0];
    const modelShort = model
        .replace(/\([^)]*\)/g, ' ')
        .replace(/[()]/g, ' ')
        .replace(/\s{2,}/g, ' ').trim()
        .split(/\s+/).slice(0, 3).join(' ');
    const volume = ccm ? (Math.round(ccm / 100) / 10).toFixed(1) : '';
    const query = [makeShort, modelShort, volume].filter(Boolean).join(' ').toLowerCase();

    const cacheKey = [makeShort, modelShort, volume, kw, engineCode, yearFrom]
        .filter(Boolean).join('_').toLowerCase().replace(/\s+/g, '');

    return { make, model, makeShort, modelShort, engineCode, fuelType, ccm, kw, bhp,
             yearFrom, volume, query, cacheKey };
}


export function parseLynxUrl() {
    const p = new URLSearchParams(location.search);
    const vendor = (p.get('vendor') || '').trim();
    const car    = (p.get('car') || '').replace(/\+/g, ' ').trim();
    const yearRaw = (p.get('year') || '').replace(/\+/g, ' ').trim();
    const mod    = (p.get('modification') || '').replace(/\+/g, ' ').trim();
    const power  = (p.get('power_engine') || '').replace(/\+/g, ' ').trim();

    if (!vendor || !car) return null;

    let engineCode = '', engineName = mod;
    const ecMatch = mod.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
    if (ecMatch) {
        engineName = ecMatch[1].trim();
        engineCode = ecMatch[2].trim();
    }

    let yearFrom = null;
    const yMatch = yearRaw.match(/(\d{1,2})\/(\d{2,4})/);
    if (yMatch) {
        let y = parseInt(yMatch[2]);
        if (y < 100) y += y < 50 ? 2000 : 1900;
        yearFrom = y;
    }

    let kw = null, bhp = null;
    const pMatch = power.match(/(\d+)\s*\((\d+)\)/);
    if (pMatch) {
        kw = parseInt(pMatch[1]);
        bhp = parseInt(pMatch[2]);
    } else {
        const single = power.match(/(\d+)/);
        if (single) kw = parseInt(single[1]);
    }

    const modelClean = car
        .replace(/\([^)]*\)/g, ' ')
        .replace(/\s+\d{1,2}[\/\-]\d{0,4}-?\s*$/g, '')
        .replace(/\s+\d{1,2}-\s*$/g, '')
        .replace(/[-\s]+$/g, '')
        .replace(/\s{2,}/g, ' ').trim();

    let volume = '';
    const skipVolume = /^(BMW|MERCEDES|MERCEDES-BENZ)$/i.test(vendor);
    if (!skipVolume) {
        const volMatch = engineName.match(/(\d\.\d)/);
        if (volMatch) volume = volMatch[1];
    }

    const make = vendor;
    const makeShort = make.split(/\s+/)[0];
    const modelShort = modelClean.split(/\s+/).slice(0, 3).join(' ') || car;

    const queryParts = [makeShort, modelShort];
    if (engineName) queryParts.push(engineName);
    else if (volume) queryParts.push(volume);
    const query = queryParts.filter(Boolean).join(' ').toLowerCase();

    const cacheKey = [makeShort, modelShort, volume, kw, engineCode, yearFrom]
        .filter(Boolean).join('_').toLowerCase().replace(/\s+/g, '');

    let fuelType = '';
    const allText = (engineName + ' ' + engineCode).toUpperCase();
    if (/\bD\b|TDI|HDI|CDI|CRDI|TDCI|JTDM|MULTIJET|DTI|CTDI/i.test(allText)) {
        fuelType = '05';
    }

    return {
        make, model: car, makeShort, modelShort,
        engineCode, engineName, fuelType,
        ccm: null,
        kw, bhp,
        yearFrom, volume, query, cacheKey,
    };
}

