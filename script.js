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

// Function to fetch and parse CSV data as a grid (without headers)
async function fetchCsvAsGrid(url) {
    return new Promise((resolve, reject) => {
        Papa.parse(url, {
            download: true,
            header: false,
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
                fetchCsvAsGrid('fire%20weather%20-%20FFM%20Correction%20Values.csv'),
                fetchCsvAsGrid('fire%20weather%20-%20Fine%20Fuel%20Moisture%20Table.csv'),
                fetchCsvAsGrid('fire%20weather%20-%20Probability%20of%20Ignition.csv')
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

function getFfmBase(temp, rh, grid) {
    if (isNaN(temp) || isNaN(rh)) {
        throw new Error("Invalid temperature or humidity input.");
    }

    // The temperature ranges are in the first column, starting from the 4th row (index 3)
    const tempRanges = grid.slice(3).map(row => row[0]);
    const tempRowIndex = tempRanges.findIndex(range => {
        if (!range) return false;
        const [min, max] = range.split(' to ').map(Number);
        return temp >= min && temp <= max;
    });

    if (tempRowIndex === -1) {
        throw new Error("Temperature is out of range.");
    }

    // The humidity ranges are in the second row (index 1)
    const rhRanges = grid[1];
    const rhColIndex = rhRanges.findIndex(range => {
        if (!range) return false;
        const [min, max] = range.split('-').map(Number);
        return rh >= min && rh <= max;
    });

    if (rhColIndex === -1) {
        throw new Error("Relative humidity is out of range.");
    }

    // The data starts at row 4, column 1
    const dataRow = grid[tempRowIndex + 3];
    if (!dataRow || isNaN(parseInt(dataRow[rhColIndex]))) {
        throw new Error("Could not find a valid FFM base value.");
    }

    return parseInt(dataRow[rhColIndex]);
}

function getFfmCorrection(month, time, shade, grid) {
    if (!month || !time || !shade) {
        throw new Error("Invalid month, time, or shade input.");
    }

    const monthGroups = {
        "may-jun-jul": { colOffset: 0, months: ["may", "jun", "jul"] },
        "feb-mar-apr-aug-sep-oct": { colOffset: 8, months: ["feb", "mar", "apr", "aug", "sep", "oct"] },
        "nov-dec-jan": { colOffset: 16, months: ["nov", "dec", "jan"] }
    };

    let selectedGroup;
    for (const key in monthGroups) {
        if (monthGroups[key].months.includes(month)) {
            selectedGroup = monthGroups[key];
            break;
        }
    }

    if (!selectedGroup) {
        throw new Error("Invalid month selected.");
    }

    // The time row is the second row in the grid (index 1)
    const timeRow = grid[1];
    // Find the time column within the correct month group
    const timeColIndex = timeRow.findIndex((t, index) => index >= selectedGroup.colOffset && t === time);


    if (timeColIndex === -1) {
        throw new Error("Invalid time selected.");
    }

    // Determine the data row based on the shade condition
    // "Clear" is in row 3 (index 2), and its data is in row 4 (index 3)
    // "Cloudy" is in row 5 (index 4), and its data is in row 6 (index 5)
    const dataRowIndex = shade === 'unshaded' ? 3 : 5;
    const dataRow = grid[dataRowIndex];

    if (!dataRow || isNaN(parseInt(dataRow[timeColIndex]))) {
        throw new Error("Could not find a valid correction value for the selected time and shade.");
    }

    return parseInt(dataRow[timeColIndex]);
}


function getPig(temp, ffm, shade, grid) {
    if (isNaN(temp) || isNaN(ffm)) {
        throw new Error("Invalid temperature or FFM input.");
    }

    // Find the start of the unshaded and shaded sections
    const unshadedHeaderIndex = grid.findIndex(row => row.includes("UNSHADED <50%"));
    const shadedHeaderIndex = grid.findIndex(row => row.includes("SHADED >50%"));

    if (unshadedHeaderIndex === -1 || shadedHeaderIndex === -1) {
        throw new Error("Could not find PIG data tables.");
    }

    const tableStartIndex = shade === 'unshaded' ? unshadedHeaderIndex : shadedHeaderIndex;

    // The temperature ranges are in the first column of each sub-table
    const tempRanges = grid.slice(tableStartIndex + 2).map(row => row[0]);
    const tempRowIndex = tempRanges.findIndex(range => {
        if (!range) return false;
        const [min, max] = range.split('-').map(Number);
        if (max) {
            return temp >= min && temp <= max;
        }
        return temp >= parseInt(range.slice(0,-1)); // For "110 +"
    });

    if (tempRowIndex === -1) {
        throw new Error("Temperature is out of range for PIG calculation.");
    }

    // FFM values are the headers in the row after the section header
    const ffmHeaderRow = grid[tableStartIndex + 1];
    const ffmValue = Math.max(2, Math.min(17, Math.round(ffm)));
    const ffmColIndex = ffmHeaderRow.findIndex(header => parseInt(header) === ffmValue);

    if (ffmColIndex === -1) {
        throw new Error("Could not find a valid PIG value for the calculated FFM.");
    }

    const dataRow = grid[tableStartIndex + 2 + tempRowIndex];
    if (!dataRow || isNaN(parseInt(dataRow[ffmColIndex]))) {
        throw new Error("Could not find a valid PIG value.");
    }

    return parseInt(dataRow[ffmColIndex]);
}


// --- Event Listener ---
document.addEventListener('DOMContentLoaded', (event) => {
    document.getElementById('calculateBtn').addEventListener('click', calculate);
});
