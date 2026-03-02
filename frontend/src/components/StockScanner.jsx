import React, { useState, useEffect } from 'react';

const StockScanner = () => {
  const [stocks, setStocks] = useState([]);
  
  // 1. New State for the Universal Search Box
  const [searchTerm, setSearchTerm] = useState("");

  useEffect(() => {
    // Note: If you eventually update this to filter by specific industries, 
    // this will need to be changed to a POST request.
    fetch('https://algo-scanner-lnck.onrender.com/api/stocks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Sending an empty array for now. Adjust if you have selected industries!
        body: JSON.stringify({ industries: [] }) 
    }) 
      .then(res => res.json())
      .then(data => {
          // FastAPI returns the array inside a "data" key
          setStocks(data.data || []);
      })
      .catch(err => console.log("Scanner API not running or wrong URL", err));
  }, []);

  // 2. Universal Search Logic (Filters all columns instantly)
  const displayedStocks = stocks.filter((stock) => {
    // If the search box is empty, show everything
    if (!searchTerm) return true; 
    
    // Convert to lowercase for easy matching
    const lowerSearch = searchTerm.toLowerCase();
    
    // Check if ANY value in the stock's data matches the search term
    return Object.values(stock).some(value => 
      String(value).toLowerCase().includes(lowerSearch)
    );
  });

  // 3. Button Handlers
  const handleSelectAll = () => {
      // NOTE: Since your actual "Sectors/Industries" lists aren't in this specific file,
      // you will need to pass this function down from App.jsx if you want it to check the boxes.
      console.log("Select All Triggered");
  };

  const handleClear = () => {
      setSearchTerm(""); // Clears the search box
      // Add logic here if you also want this to uncheck your industry boxes
  };

  return (
    <div className="p-4 bg-white rounded shadow">
      
      {/* --- TOP TAB: Title, Search Box, and Buttons --- */}
      <div className="flex flex-col md:flex-row justify-between items-center mb-6 gap-4">
        <h2 className="text-xl font-bold">Stock Scanner Results</h2>
        
        <div className="flex items-center gap-3">
          {/* Universal Search Box */}
          <input
            type="text"
            placeholder="🔍 Search symbol, industry, RS..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="p-2 border rounded border-gray-300 w-64 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          
          {/* Select All Button */}
          <button 
            onClick={handleSelectAll}
            className="px-4 py-2 bg-blue-600 text-white font-semibold rounded hover:bg-blue-700 transition"
          >
            Select All
          </button>

          {/* Clear Button */}
          <button 
            onClick={handleClear}
            className="px-4 py-2 bg-gray-200 text-gray-700 font-semibold rounded hover:bg-gray-300 transition"
          >
            Clear
          </button>
        </div>
      </div>
      {/* ----------------------------------------------- */}

      <div className="overflow-x-auto">
        <table className="min-w-full text-left border-collapse">
          <thead>
            <tr className="bg-gray-100 border-b">
              <th className="p-2">Symbol</th>
              <th className="p-2">Industry</th>
              <th className="p-2">RS Score</th>
              <th className="p-2">Daily Cross</th>
              <th className="p-2">1H Pullback</th>
              <th className="p-2">15M Pullback</th>
            </tr>
          </thead>
          <tbody>
            {displayedStocks.length === 0 ? (
              <tr><td colSpan="6" className="p-4 text-center text-gray-500">No matching stocks found.</td></tr>
            ) : (
              // Use the filtered displayedStocks array instead of the raw stocks array
              displayedStocks.map((stock, i) => (
                <tr key={i} className="border-b hover:bg-gray-50">
                  <td className="p-2 font-bold">{stock.fyers_symbol}</td>
                  <td className="p-2">{stock.industry}</td>
                  <td className="p-2">{stock.rs_score}</td>
                  <td className="p-2">
                    <span className={stock.daily_cross_active === 'Yes' ? 'text-green-600 font-bold' : 'text-gray-400'}>
                      {stock.daily_cross_active === 'Yes' ? stock.daily_cross_date : 'No'}
                    </span>
                  </td>
                  <td className="p-2 text-blue-600">{stock.first_1h_cross_time || '--'}</td>
                  <td className="p-2 text-purple-600">{stock.first_15m_cross_time || '--'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default StockScanner;