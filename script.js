// Function to fetch and parse CSV data
async function fetchCsv(url) {
    return new Promise((resolve, reject) => {
        Papa.parse(url, {
            download: true,
            header: true,
            complete: (results) => {
                resolve(results.data);
            },
            error: (error) => {
                reject(error);
            },
        });
    });
}

// Main calculation logic
async function calculate() {
    try {
        // Get user inputs
        const dryBulbTemp = parseInt(document.getElementById('dryBulbTemp').value);
        const relativeHumidity = parseInt(document.getElementById('relativeHumidity').value);
        const month = document.getElementById('month').value;
        const time = document.getElementById('time').value;
        const shade = document.getElementById('shade').value;

        // --- 1. Load Data ---
        let ffmCorrectionValues, fineFuelMoistureTable, probabilityOfIgnitionTable;
        try {
            [ffmCorrectionValues, fineFuelMoistureTable, probabilityOfIgnitionTable] = await Promise.all([
                fetchCsv('fire%20weather%20-%20FFM%20Correction%20Values.csv'),
                fetchCsv('fire%20weather%20-%20Fine%20Fuel%20Moisture%20Table.csv'),
                fetchCsv('fire%20weather%20-%20Probability%20of%20Ignition.csv')
            ]);
        } catch (error) {
            console.error("Error loading CSV data:", error);
            alert("Failed to load necessary data. Please check the console for details.");
            return;
        }

        // --- 2. Calculate FFM ---
        // a. Find the base FFM from the Fine Fuel Moisture Table
        const ffmBase = getFfmBase(dryBulbTemp, relativeHumidity, fineFuelMoistureTable);

        // b. Find the correction value
        const correction = getFfmCorrection(month, time, shade, ffmCorrectionValues);

        // c. Calculate the final FFM
        const ffmResult = ffmBase + correction;
        document.getElementById('ffmResult').textContent = ffmResult;

        // --- 3. Calculate PIG ---
        const pigResult = getPig(dryBulbTemp, ffmResult, shade, probabilityOfIgnitionTable);
        document.getElementById('pigResult').textContent = pigResult + '%';
    } catch (error) {
        console.error("Calculation Error:", error);
        alert("An error occurred during calculation. Please check the console for details.");
        document.getElementById('ffmResult').textContent = "Error";
    }
}


// --- Helper functions to find values in the tables ---

function getFfmBase(temp, rh, table) {
    if (isNaN(temp) || isNaN(rh)) {
        throw new Error("Invalid temperature or humidity input.");
    }

    const tempRow = table.find(row => {
        const tempValue = row['Dry Bulb Temp - F'];
        if (!tempValue) return false;

        const tempRange = tempValue.split(' to ');
        if (tempRange.length === 2) {
            return temp >= parseInt(tempRange[0]) && temp <= parseInt(tempRange[1]);
        }
        // Handle cases like "109 +"
        if (tempValue.endsWith('+')) {
            return temp >= parseInt(tempValue.slice(0, -1));
        }
        return temp === parseInt(tempValue);
    });

    if (!tempRow) {
        throw new Error("Temperature is out of range.");
    }

    const rhColumn = Object.keys(tempRow).find(key => {
        const rhRange = key.split('-');
        if (rhRange.length === 2 && !isNaN(rhRange[0]) && !isNaN(rhRange[1])) {
            return rh >= parseInt(rhRange[0]) && rh <= parseInt(rhRange[1]);
        }
        return false;
    });

    if (!rhColumn || isNaN(parseInt(tempRow[rhColumn]))) {
        throw new Error("Relative humidity is out of range or data is invalid.");
    }

    return parseInt(tempRow[rhColumn]);
}

function getFfmCorrection(month, time, shade, table) {
    if (!month || !time || !shade) {
        throw new Error("Invalid month, time, or shade input.");
    }

    const monthGroups = {
        "May, June, July": ["may", "jun", "jul"],
        "Feb, March, April, August, Sept, Oct": ["feb", "mar", "apr", "aug", "sep", "oct"],
        "Nov, Dec, Jan": ["nov", "dec", "jan"]
    };

    let monthGroupKey = Object.keys(monthGroups).find(key => monthGroups[key].includes(month));

    if (!monthGroupKey) {
        throw new Error("Invalid month selected.");
    }

    const shadeKey = shade === 'shaded' ? 'Cloudy and/or Canopy (more than 50% Shaded)' : 'Clear and/or No Canopy (Less than 50% Shaded)';

    // Find the header row that contains our month group key
    const headerRowIndex = table.findIndex(row => Object.values(row).includes(monthGroupKey));
    if (headerRowIndex === -1) {
        throw new Error("Could not find data for the selected month group.");
    }

    // Now, find the row for the shade condition.
    const shadeHeaderRowIndex = table.findIndex((row, index) => index > headerRowIndex && Object.values(row).some(v => typeof v === 'string' && v.includes(shadeKey)));

    if (shadeHeaderRowIndex === -1) {
        throw new Error("Could not find data for the selected shade condition.");
    }

    // The actual values are in the row right after the shadeKey header row
    const dataRow = table[shadeHeaderRowIndex + 1];

    if (!dataRow || isNaN(parseInt(dataRow[time]))) {
        throw new Error("Could not find a valid correction value for the selected time and shade.");
    }

    return parseInt(dataRow[time]);
}


function getPig(temp, ffm, shade, table) {
    if (isNaN(temp) || isNaN(ffm)) {
        throw new Error("Invalid temperature or FFM input.");
    }

    const unshadedHeader = "UNSHADED <50%";
    const shadedHeader = "SHADED >50%";

    // Find the starting index of the unshaded and shaded tables
    const unshadedStartIndex = table.findIndex(row => Object.values(row).includes(unshadedHeader));
    const shadedStartIndex = table.findIndex(row => Object.values(row).includes(shadedHeader));

    if (unshadedStartIndex === -1 || shadedStartIndex === -1) {
        throw new Error("Could not find PIG data tables.");
    }

    const shadeTable = shade === 'shaded'
        ? table.slice(shadedStartIndex + 2, table.length) // +2 to skip header and blank row
        : table.slice(unshadedStartIndex + 2, shadedStartIndex);

    const tempRow = shadeTable.find(row => {
        const tempValue = row['Dry Bulb Temp'];
        if (!tempValue) return false;

        const tempRange = tempValue.split('-');
        if (tempRange.length === 2) {
            return temp >= parseInt(tempRange[0]) && temp <= parseInt(tempRange[1]);
        }
        if (tempValue.endsWith('+')) {
            return temp >= parseInt(tempValue.slice(0, -1));
        }
        return false; // No exact match, only ranges
    });

    if (!tempRow) {
        throw new Error("Temperature is out of range for PIG calculation.");
    }

    // Find the correct FFM column. The headers are numbers from 2 to 17.
    const ffmColumnValue = Math.max(2, Math.min(17, Math.round(ffm)));
    const ffmColumnKey = Object.keys(tempRow).find(key => parseInt(key) === ffmColumnValue);

    if (!ffmColumnKey || isNaN(parseInt(tempRow[ffmColumnKey]))) {
        throw new Error("Could not find a valid PIG value for the calculated FFM.");
    }

    return parseInt(tempRow[ffmColumnKey]);
}


// --- Event Listener ---
document.addEventListener('DOMContentLoaded', (event) => {
    document.getElementById('calculateBtn').addEventListener('click', calculate);
});
