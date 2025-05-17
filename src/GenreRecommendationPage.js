import React, { useState, useEffect } from 'react';
import { AiOutlineLoading3Quarters } from 'react-icons/ai';

const CACHE_EXPIRY = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
const BATCH_SIZE = 3; // Number of parallel requests
const RATE_LIMIT_DELAY = 250; // 250ms between requests

const LoadingSpinner = () => (
  <div className="flex flex-col items-center justify-center min-h-[100px]">
    <AiOutlineLoading3Quarters className="w-4 h-4 mb-2 text-blue-500 loading-spinner" />
    <div className="text-sm font-medium text-gray-700 animate-pulse">Finding anime recommendations...</div>
    <div className="text-xs text-gray-500 mt-1">This may take a few moments</div>
  </div>
);

const LoadingCard = () => (
  <div className="anime-card animate-pulse">
    <div className="aspect-w-2 bg-gray-200"></div>
    <div className="p-4 space-y-3">
      <div className="h-4 bg-gray-200 rounded w-3/4"></div>
      <div className="flex flex-wrap gap-1">
        <div className="h-6 bg-gray-200 rounded w-16"></div>
        <div className="h-6 bg-gray-200 rounded w-20"></div>
      </div>
      <div className="h-4 bg-gray-200 rounded w-1/4"></div>
    </div>
  </div>
);

const AnimeCard = ({ rec, imageUrl }) => (
  <div className="anime-card">
    <div className="aspect-w-2">
      <img
        src={imageUrl}
        alt={`${rec.name} poster`}
        className="w-full h-full object-cover"
      />
    </div>
    <div className="p-4">
      <h4 className="font-medium text-gray-900 hover:text-blue-600 cursor-pointer line-clamp-2 mb-2">
        {rec.name}
      </h4>
      <div className="flex flex-wrap gap-1 mb-2">
        {rec.genre?.split(',').map((g, i) => (
          <span key={i} className="genre-tag">
            {g.trim()}
          </span>
        ))}
      </div>
      <div className="text-sm font-medium text-gray-900">
        Score: {rec.rating || 'N/A'}
      </div>
    </div>
  </div>
);

const GenreRecommendationPage = ({ apiUrl }) => {
  const [genres, setGenres] = useState(['Action']);
  const [typeAnime, setTypeAnime] = useState('all');
  const [topN, setTopN] = useState(5);
  const [recommendations, setRecommendations] = useState({ popular: [], relevant: [] });
  const [readyCards, setReadyCards] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [imageErrors, setImageErrors] = useState({});

  // Load cached images on component mount
  useEffect(() => {
    try {
      const cachedData = localStorage.getItem('animeImageCache');
      if (cachedData) {
        const { images: cachedImages, timestamp } = JSON.parse(cachedData);
        if (Date.now() - timestamp < CACHE_EXPIRY) {
          setReadyCards(Object.entries(cachedImages).map(([name, url]) => ({ rec: { name }, imageUrl: url })));
        } else {
          localStorage.removeItem('animeImageCache');
        }
      }
    } catch (err) {
      console.error('Error loading cached images:', err);
    }
  }, []);

  // Save images to cache whenever they update
  useEffect(() => {
    if (Object.keys(readyCards).length > 0) {
      try {
        localStorage.setItem('animeImageCache', JSON.stringify({
          images: readyCards.reduce((acc, card) => ({ ...acc, [card.rec.name]: card.imageUrl }), {}),
          timestamp: Date.now()
        }));
      } catch (err) {
        console.error('Error caching images:', err);
      }
    }
  }, [readyCards]);

  const fetchRecommendations = async () => {
    setLoading(true);
    setError(null);
    setRecommendations({ popular: [], relevant: [] });
    setReadyCards([]);
    
    try {
      console.log('Fetching from:', `${apiUrl}/recommend/genre`);
      console.log('Request body:', { genres, type_anime: typeAnime, top_n: topN });
      
      const response = await fetch(`${apiUrl}/recommend/genre`, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ genres, type_anime: typeAnime, top_n: topN })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
      }
      
      const data = await response.json();
      console.log('Raw API Response:', data); // Log the raw response
      
      // Handle different response formats
      let processedData = {
        popular: [],
        relevant: []
      };

      if (Array.isArray(data)) {
        // If response is an array, treat it as relevant recommendations
        processedData.relevant = data;
      } else if (typeof data === 'object') {
        // If response is an object, try to extract popular and relevant
        processedData = {
          popular: Array.isArray(data.popular) ? data.popular : [],
          relevant: Array.isArray(data.relevant) ? data.relevant : []
        };
      }

      console.log('Processed recommendations:', processedData);
      
      if (processedData.popular.length > 0 || processedData.relevant.length > 0) {
        setRecommendations(processedData);
        const allRecs = [...processedData.popular, ...processedData.relevant];
        // Don't set loading to false yet, wait for first batch of images
        await fetchImages(allRecs);
      } else {
        setError('No recommendations found for these genres');
        setLoading(false);
      }
    } catch (error) {
      console.error('Fetch error:', error); // Add detailed error logging
      setError('Error fetching recommendations: ' + error.message);
      setLoading(false);
    }
  };

  const cleanAnimeName = (name) => {
    // Remove special characters, extra spaces, and common suffixes
    return name
      .replace(/[:\-～!@#$%^&*()_+=]/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/(TV|Movie|OVA|Special)$/i, '')
      .replace(/Season \d+/i, '')
      .replace(/Part \d+/i, '')
      .trim();
  };

  const fetchImageWithRetry = async (animeName, retryCount = 3) => {
    // Check cache first
    const cachedData = localStorage.getItem('animeImageCache');
    if (cachedData) {
      const { images: cachedImages, timestamp } = JSON.parse(cachedData);
      if (Date.now() - timestamp < CACHE_EXPIRY && cachedImages[animeName]) {
        return cachedImages[animeName];
      }
    }

    const searchVariations = [
      animeName,                              // Original name
      cleanAnimeName(animeName),              // Cleaned name
      animeName.split(':')[0],                // First part before colon
      cleanAnimeName(animeName).split(' ')[0] // First word of cleaned name
    ];

    for (let variation of searchVariations) {
      for (let attempt = 0; attempt < retryCount; attempt++) {
        try {
          const searchResponse = await fetch(
            `https://api.jikan.moe/v4/anime?q=${encodeURIComponent(variation)}&limit=5`
          );

          if (!searchResponse.ok) {
            if (searchResponse.status === 429) { // Rate limit hit
              await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
              continue; // Retry this variation
            }
            throw new Error(`Search failed: ${searchResponse.status}`);
          }

          const searchData = await searchResponse.json();
          const results = searchData.data || [];

          // Try to find the best match
          const bestMatch = results.find(anime => {
            const cleanTitle = cleanAnimeName(anime.title).toLowerCase();
            const cleanSearchTitle = cleanAnimeName(variation).toLowerCase();
            return cleanTitle.includes(cleanSearchTitle) || 
                   cleanSearchTitle.includes(cleanTitle) ||
                   (anime.titles || []).some(t => 
                     cleanAnimeName(t.title).toLowerCase().includes(cleanSearchTitle)
                   );
          });

          if (bestMatch?.images?.jpg?.image_url) {
            // Verify the image can be loaded
            const img = new Image();
            await new Promise((resolve, reject) => {
              img.onload = resolve;
              img.onerror = reject;
              img.src = bestMatch.images.jpg.image_url;
            });
            return bestMatch.images.jpg.image_url;
          }
        } catch (err) {
          console.error(`Attempt ${attempt + 1} failed for ${variation}:`, err);
          if (attempt === retryCount - 1) continue; // Try next variation if all attempts fail
          await new Promise(resolve => setTimeout(resolve, 1000)); // Wait before retry
        }
      }
    }
    throw new Error('No matching image found');
  };

  const fetchImages = async (recs) => {
    const newReadyCards = [];
    
    // Process recommendations in batches
    for (let i = 0; i < recs.length; i += BATCH_SIZE) {
      const batch = recs.slice(i, i + BATCH_SIZE);
      
      // Fetch batch in parallel
      const batchPromises = batch.map(async (rec) => {
        try {
          const imageUrl = await fetchImageWithRetry(rec.name);
          if (imageUrl) {
            newReadyCards.push({ rec, imageUrl });
            setReadyCards(current => [...current, { rec, imageUrl }]);
          }
        } catch (err) {
          console.error(`Error fetching image for ${rec.name}:`, err);
        }
      });

      await Promise.all(batchPromises);
      
      // After first batch is loaded, remove loading state
      if (i === 0) {
        setLoading(false);
      }
      
      // Add delay between batches to respect rate limits
      if (i + BATCH_SIZE < recs.length) {
        await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY));
      }
    }
  };

  return (
    <div>
      <h2 className="text-2xl font-bold mb-6 text-gray-900">Find Anime by Genre</h2>
      
      <div className="max-w-2xl space-y-4 mb-8">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Select Genres
          </label>
          <input
            type="text"
            value={genres.join(', ')}
            onChange={(e) => setGenres(e.target.value.split(',').map(g => g.trim()))}
            className="input-field"
            placeholder="e.g. Action, Romance, Comedy"
            disabled={loading}
          />
        </div>
        
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Type
            </label>
            <select
              value={typeAnime}
              onChange={(e) => setTypeAnime(e.target.value)}
              className="input-field"
              disabled={loading}
            >
              <option value="all">All Types</option>
              <option value="TV">TV</option>
              <option value="Movie">Movie</option>
              <option value="OVA">OVA</option>
            </select>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Number of Results
            </label>
            <input
              type="number"
              value={topN}
              onChange={(e) => setTopN(Math.max(1, Math.min(20, parseInt(e.target.value))))}
              min="1"
              max="20"
              className="input-field"
              disabled={loading}
            />
          </div>
        </div>

        <div>
          <button
            onClick={fetchRecommendations}
            disabled={loading || genres.length === 0}
            className={`submit-button ${loading ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            {loading ? 'Searching...' : 'Find Recommendations'}
          </button>
        </div>
      </div>

      {error && (
        <div className="error-message">{error}</div>
      )}

      {loading && <LoadingSpinner />}

      {!loading && (recommendations.popular.length > 0 || recommendations.relevant.length > 0) && (
        <div className="space-y-8">
          {recommendations.popular.length > 0 && (
            <div>
              <h3 className="text-xl font-semibold text-gray-900 mb-6">Popular Recommendations</h3>
              <div className="anime-grid">
                {recommendations.popular.map((rec, index) => {
                  const readyCard = readyCards.find(card => card.rec.name === rec.name);
                  return readyCard ? (
                    <AnimeCard key={index} rec={readyCard.rec} imageUrl={readyCard.imageUrl} />
                  ) : (
                    <LoadingCard key={index} />
                  );
                })}
              </div>
            </div>
          )}

          {recommendations.relevant.length > 0 && (
            <div>
              <h3 className="text-xl font-semibold text-gray-900 mb-6">More Recommendations</h3>
              <div className="anime-grid">
                {recommendations.relevant.map((rec, index) => {
                  const readyCard = readyCards.find(card => card.rec.name === rec.name);
                  return readyCard ? (
                    <AnimeCard key={index} rec={readyCard.rec} imageUrl={readyCard.imageUrl} />
                  ) : (
                    <LoadingCard key={index} />
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {!loading && !error && recommendations.popular.length === 0 && recommendations.relevant.length === 0 && (
        <div className="info-message">
          Enter genres to find anime recommendations.
        </div>
      )}
    </div>
  );
};

export default GenreRecommendationPage;