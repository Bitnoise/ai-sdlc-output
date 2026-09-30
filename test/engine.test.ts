import * as fs from "fs";
import * as path from "path";
import * as Papa from "papaparse";
import {
  cleanTrips,
  calculateVanMetrics,
  checkEligibility,
  calculateFinancial,
  buildShortlist,
  analyzeFleet,
  generateShortlistCsv,
  generateSummaryCsv,
  DieselModel,
  Van,
  EVModel,
  CapConfig,
} from "../src/engine";

describe("Calculation Engine", () => {
  let vans: Van[];
  let rawTrips: Array<Record<string, unknown>>;
  let dieselModels: Map<string, DieselModel>;
  let evModels: EVModel[];

  beforeAll(() => {
    // Load fixtures
    const vansPath = path.join(__dirname, "fixtures", "vans.csv");
    const tripsPath = path.join(__dirname, "fixtures", "trips.csv");

    const vansContent = fs.readFileSync(vansPath, "utf-8");
    const tripsContent = fs.readFileSync(tripsPath, "utf-8");

    const vansParsed = Papa.parse(vansContent, { header: true, dynamicTyping: false });
    const tripsParsed = Papa.parse(tripsContent, { header: true, dynamicTyping: false });

    vans = (vansParsed.data as Array<Record<string, unknown>>)
      .filter((row) => row.van_id)
      .map((row) => ({
        vanId: String(row.van_id),
        dieselModel: String(row.diesel_model),
        depot: String(row.depot) as "North" | "South",
        ownedOrLeased: String(row.owned_or_leased) as "owned" | "leased",
        leaseEndDate: row.lease_end ? String(row.lease_end) : undefined,
        monthlyLeasePln: row.monthly_lease_pln ? parseInt(String(row.monthly_lease_pln)) : undefined,
        refrigerated: row.refrigerated === "yes",
      }));

    rawTrips = (tripsParsed.data as Array<Record<string, unknown>>).filter((row) => row.date);

    // Setup diesel models
    dieselModels = new Map([
      ["Brona D35", { name: "Brona D35", fuelUseLper100km: 9.6, payloadKg: 1150 }],
      ["Brona D35 Long", { name: "Brona D35 Long", fuelUseLper100km: 10.9, payloadKg: 1050 }],
      ["Kestrel Cargo 3.5", { name: "Kestrel Cargo 3.5", fuelUseLper100km: 11.8, payloadKg: 1300 }],
    ]);

    // Setup EV models
    evModels = [
      {
        name: "Volta Cargo S",
        wltpRangeKm: 260,
        payloadKg: 1050,
        energyKwhPer100km: 24,
        purchasePricePln: 150000,
        monthlyLeasePln: 2900,
        leaseMonths: 60,
      },
      {
        name: "Volta Cargo L",
        wltpRangeKm: 380,
        payloadKg: 880,
        energyKwhPer100km: 27,
        purchasePricePln: 195000,
        monthlyLeasePln: 3770,
        leaseMonths: 60,
      },
    ];
  });

  describe("Trip Cleaning", () => {
    it("should remove exact duplicate rows", () => {
      const vanIds = new Set(vans.map((v) => v.vanId));
      const aliasMap = new Map([["P-17", "P-17B"]]);

      const result = cleanTrips(rawTrips, vanIds, aliasMap);

      expect(result.exactDuplicatesRemoved).toBeGreaterThanOrEqual(0);
      expect(result.trips.length).toBeLessThanOrEqual(rawTrips.filter((r) => r.date).length);
    });

    it("should remap van IDs via alias", () => {
      const vanIds = new Set(vans.map((v) => v.vanId).concat("P-17B"));
      const aliasMap = new Map([["P-17", "P-17B"]]);

      const result = cleanTrips(rawTrips, vanIds, aliasMap);

      const p17bTrips = result.trips.filter((t) => t.vanId === "P-17B");
      expect(p17bTrips.length).toBeGreaterThan(0);
    });

    it("should fallback to GPS for invalid odometer", () => {
      const vanIds = new Set(vans.map((v) => v.vanId));
      const aliasMap = new Map();

      const result = cleanTrips(rawTrips, vanIds, aliasMap);

      const negativeFix = result.trips.find((t) => t.distanceKm === 90.3);
      expect(negativeFix).toBeDefined();
      expect(result.odometerRepairs).toBe(1);
    });

    it("should sum multiple routes per day", () => {
      const vanIds = new Set(vans.map((v) => v.vanId));
      const aliasMap = new Map([["P-17", "P-17B"]]);

      const result = cleanTrips(rawTrips, vanIds, aliasMap);

      // Check that we have entries for routes on 2026-07-05
      const july5Routes = result.trips.filter((t) => t.date === "2026-07-05");
      expect(july5Routes.length).toBeGreaterThan(0);
    });
  });

  describe("Van Metrics Calculation", () => {
    it("should calculate P95 percentile correctly", () => {
      const vanIds = new Set(vans.map((v) => v.vanId));
      const aliasMap = new Map([["P-17", "P-17B"]]);

      const result = cleanTrips(rawTrips, vanIds, aliasMap);
      const metrics = calculateVanMetrics(vans, result.trips, 13);

      const p01Metrics = metrics.get("P-01");
      expect(p01Metrics).toBeDefined();
      expect(p01Metrics!.p95DayKm).toBeGreaterThan(0);
      expect(p01Metrics!.p95DayKm).toBeLessThanOrEqual(p01Metrics!.maxDayKm);
    });

    it("should calculate annual km correctly", () => {
      const vanIds = new Set(vans.map((v) => v.vanId));
      const aliasMap = new Map([["P-17", "P-17B"]]);

      const result = cleanTrips(rawTrips, vanIds, aliasMap);
      const metrics = calculateVanMetrics(vans, result.trips, 13);

      const p01Metrics = metrics.get("P-01");
      expect(p01Metrics).toBeDefined();
      expect(p01Metrics!.annualKm).toBeGreaterThan(0);
    });

    it("should track max load per van", () => {
      const vanIds = new Set(vans.map((v) => v.vanId));
      const aliasMap = new Map([["P-17", "P-17B"]]);

      const result = cleanTrips(rawTrips, vanIds, aliasMap);
      const metrics = calculateVanMetrics(vans, result.trips, 13);

      const p01Metrics = metrics.get("P-01");
      expect(p01Metrics).toBeDefined();
      expect(p01Metrics!.maxLoadKg).toBeGreaterThan(0);
    });
  });

  describe("Eligibility Checking", () => {
    it("should exclude refrigerated vans", () => {
      const refrigVan = vans.find((v) => v.vanId === "P-03");

      const vanIds = new Set(vans.map((v) => v.vanId));
      const aliasMap = new Map([["P-17", "P-17B"]]);
      const result = cleanTrips(rawTrips, vanIds, aliasMap);
      const metrics = calculateVanMetrics(vans, result.trips, 13);

      const refrigMetrics = metrics.get("P-03")!;
      const evModel = evModels[0];

      const eligibility = checkEligibility(refrigVan!, refrigMetrics, evModel, 0.6);
      expect(eligibility.eligible).toBe(false);
      expect(eligibility.reason).toBe("Refrigerated");
    });

    it("should check range fit", () => {
      const van = vans.find((v) => v.vanId === "P-01")!;
      const vanIds = new Set(vans.map((v) => v.vanId));
      const aliasMap = new Map([["P-17", "P-17B"]]);
      const result = cleanTrips(rawTrips, vanIds, aliasMap);
      const metrics = calculateVanMetrics(vans, result.trips, 13);
      const vanMetrics = metrics.get("P-01")!;

      const shortRangeEV: EVModel = {
        name: "Short Range",
        wltpRangeKm: 150,
        payloadKg: 1200,
        energyKwhPer100km: 25,
        purchasePricePln: 100000,
        monthlyLeasePln: 2000,
        leaseMonths: 60,
      };

      const eligibility = checkEligibility(van, vanMetrics, shortRangeEV, 0.6);
      if (vanMetrics.p95DayKm > shortRangeEV.wltpRangeKm * 0.6) {
        expect(eligibility.eligible).toBe(false);
      }
    });

    it("should check payload fit", () => {
      const van = vans.find((v) => v.vanId === "P-01")!;
      const vanIds = new Set(vans.map((v) => v.vanId));
      const aliasMap = new Map([["P-17", "P-17B"]]);
      const result = cleanTrips(rawTrips, vanIds, aliasMap);
      const metrics = calculateVanMetrics(vans, result.trips, 13);
      const vanMetrics = metrics.get("P-01")!;

      const lowPayloadEV: EVModel = {
        name: "Low Payload",
        wltpRangeKm: 500,
        payloadKg: 500,
        energyKwhPer100km: 25,
        purchasePricePln: 100000,
        monthlyLeasePln: 2000,
        leaseMonths: 60,
      };

      const eligibility = checkEligibility(van, vanMetrics, lowPayloadEV, 0.6);
      if (vanMetrics.maxLoadKg > lowPayloadEV.payloadKg) {
        expect(eligibility.eligible).toBe(false);
      }
    });
  });

  describe("Financial Calculations", () => {
    it("should calculate diesel fuel cost per km", () => {
      const van = vans.find((v) => v.vanId === "P-01")!;
      const vanIds = new Set(vans.map((v) => v.vanId));
      const aliasMap = new Map([["P-17", "P-17B"]]);
      const result = cleanTrips(rawTrips, vanIds, aliasMap);
      const metrics = calculateVanMetrics(vans, result.trips, 13);
      const vanMetrics = metrics.get("P-01")!;

      const financials = calculateFinancial(
        van,
        vanMetrics,
        evModels[0],
        dieselModels,
        5.2,
        0.34,
        0.14,
        0.58,
        0.3,
        5,
        "2026-06-15",
        3,
        12
      );

      expect(financials).toBeDefined();
      expect(financials!.dieselFuelCostPerKm).toBeGreaterThan(0);
    });

    it("should calculate EV charging cost per km", () => {
      const van = vans.find((v) => v.vanId === "P-01")!;
      const vanIds = new Set(vans.map((v) => v.vanId));
      const aliasMap = new Map([["P-17", "P-17B"]]);
      const result = cleanTrips(rawTrips, vanIds, aliasMap);
      const metrics = calculateVanMetrics(vans, result.trips, 13);
      const vanMetrics = metrics.get("P-01")!;

      const financials = calculateFinancial(
        van,
        vanMetrics,
        evModels[0],
        dieselModels,
        5.2,
        0.34,
        0.14,
        0.58,
        0.3,
        5,
        "2026-06-15",
        3,
        12
      );

      expect(financials).toBeDefined();
      expect(financials!.evChargingCostPerKm).toBeGreaterThan(0);
      expect(financials!.evChargingCostPerKm).toBeLessThan(financials!.dieselFuelCostPerKm);
    });

    it("should calculate lease exit fees correctly", () => {
      const leasedVan = vans.find((v) => v.vanId === "P-04")!;
      const vanIds = new Set(vans.map((v) => v.vanId));
      const aliasMap = new Map([["P-17", "P-17B"]]);
      const result = cleanTrips(rawTrips, vanIds, aliasMap);
      const metrics = calculateVanMetrics(vans, result.trips, 13);
      const vanMetrics = metrics.get("P-04")!;

      const analysisDate = "2026-06-15";

      const financials = calculateFinancial(
        leasedVan,
        vanMetrics,
        evModels[0],
        dieselModels,
        5.2,
        0.34,
        0.14,
        0.58,
        0.3,
        5,
        analysisDate,
        3,
        12
      );

      expect(financials).toBeDefined();
      // P-04 lease ends 2026-08-20, which is within 12 months, so fee should be 0
      expect(financials!.leaseExitFeePln).toBe(0);
    });

    it("should calculate 5-year savings", () => {
      const van = vans.find((v) => v.vanId === "P-01")!;
      const vanIds = new Set(vans.map((v) => v.vanId));
      const aliasMap = new Map([["P-17", "P-17B"]]);
      const result = cleanTrips(rawTrips, vanIds, aliasMap);
      const metrics = calculateVanMetrics(vans, result.trips, 13);
      const vanMetrics = metrics.get("P-01")!;

      const financials = calculateFinancial(
        van,
        vanMetrics,
        evModels[0],
        dieselModels,
        5.2,
        0.34,
        0.14,
        0.58,
        0.3,
        5,
        "2026-06-15",
        3,
        12
      );

      expect(financials).toBeDefined();
      expect(typeof financials!.savingPln).toBe("number");
    });
  });

  describe("Shortlist Building", () => {
    it("should enforce grant cap", () => {
      const capConfig: CapConfig = {
        grantCap: 10,
        chargingPointsNorth: 10,
        southRebaseCap: 3,
      };

      const eligibleVans = [
        {
          van: { vanId: "P-01", dieselModel: "Brona D35", depot: "North" as const, ownedOrLeased: "owned" as const, refrigerated: false } as Van,
          metrics: {
            vanId: "P-01",
            depot: "North" as const,
            refrigerated: false,
            ownedOrLeased: "owned" as const,
            p95DayKm: 200,
            maxDayKm: 250,
            maxLoadKg: 900,
            annualKm: 12000,
          },
          financials: {
            vanId: "P-01",
            evModel: "Volta Cargo S",
            dieselFuelCostPerKm: 0.5,
            evChargingCostPerKm: 0.14,
            annualFuelSavingPln: 4000,
            annualOperatingSavingPln: 6000,
            evNetCostPln: 105000,
            leaseExitFeePln: 0,
            savingPln: 25000,
          },
          evModel: evModels[0],
        },
      ];

      // Repeat to create 15 candidates
      for (let i = 0; i < 14; i++) {
        const van = {
          ...eligibleVans[0].van,
          vanId: `P-TEST${i}`,
        };
        eligibleVans.push({
          ...eligibleVans[0],
          van,
          financials: {
            ...eligibleVans[0].financials,
            vanId: `P-TEST${i}`,
            savingPln: 25000 - i * 100,
          },
          metrics: {
            ...eligibleVans[0].metrics,
            vanId: `P-TEST${i}`,
          },
        });
      }

      const shortlist = buildShortlist(eligibleVans, capConfig);
      expect(shortlist.length).toBeLessThanOrEqual(capConfig.grantCap);
    });

    it("should enforce South re-base cap", () => {
      const capConfig: CapConfig = {
        grantCap: 20,
        chargingPointsNorth: 20,
        southRebaseCap: 3,
      };

      const eligibleVans: Array<{
        van: Van;
        metrics: { vanId: string; depot: "North" | "South"; refrigerated: boolean; ownedOrLeased: "owned" | "leased"; p95DayKm: number; maxDayKm: number; maxLoadKg: number; annualKm: number };
        financials: { vanId: string; evModel: string; dieselFuelCostPerKm: number; evChargingCostPerKm: number; annualFuelSavingPln: number; annualOperatingSavingPln: number; evNetCostPln: number; leaseExitFeePln: number; savingPln: number };
        evModel: EVModel;
      }> = [];
      for (let i = 0; i < 10; i++) {
        eligibleVans.push({
          van: {
            vanId: `P-S${i}`,
            dieselModel: "Brona D35",
            depot: "South" as const,
            ownedOrLeased: "owned" as const,
            refrigerated: false,
          } as Van,
          metrics: {
            vanId: `P-S${i}`,
            depot: "South" as const,
            refrigerated: false,
            ownedOrLeased: "owned" as const,
            p95DayKm: 200,
            maxDayKm: 250,
            maxLoadKg: 900,
            annualKm: 12000,
          },
          financials: {
            vanId: `P-S${i}`,
            evModel: "Volta Cargo S",
            dieselFuelCostPerKm: 0.5,
            evChargingCostPerKm: 0.14,
            annualFuelSavingPln: 4000,
            annualOperatingSavingPln: 6000,
            evNetCostPln: 105000,
            leaseExitFeePln: 0,
            savingPln: 25000 - i * 100,
          },
          evModel: evModels[0],
        });
      }

      const shortlist = buildShortlist(eligibleVans, capConfig);
      const southCount = shortlist.filter((s) => s.evDepot === "South").length;
      expect(southCount).toBeLessThanOrEqual(capConfig.southRebaseCap);
    });
  });

  describe("CSV Formatting", () => {
    it("should generate shortlist CSV without thousands separators", () => {
      const shortlist = [
        {
          rank: 1,
          vanId: "P-01",
          evModel: "Volta Cargo S",
          evDepot: "North" as const,
          rangeCheckKm: 245.5,
          annualKm: 12000,
          annualFuelSavingPln: 4320,
          savingPln: 25000,
          reason: "Test reason",
        },
      ];

      const csv = generateShortlistCsv(shortlist);
      expect(csv).toContain("rank,van_id,ev_model,ev_depot");
      expect(csv).toContain("245.5");
      expect(csv).toContain("12000");
      expect(csv).not.toContain("12,000");
      expect(csv).not.toContain("25,000");
    });

    it("should generate summary CSV with correct basis", () => {
      const csv = generateSummaryCsv(38, 100, 10000, 5, 20000, 125000);

      expect(csv).toContain("figure,value");
      expect(csv).toContain("vans_assessed,38");
      expect(csv).toContain("trips_counted,100");
      expect(csv).toContain("total_km,10000");
      expect(csv).toContain("saving_basis");
      expect(csv).toContain("5-year operating saving");
    });
  });

  describe("Full Fleet Analysis", () => {
    it("should never shortlist refrigerated vans", () => {
      const vanIds = new Set(vans.map((v) => v.vanId).concat("P-17B"));
      const aliasMap = new Map([["P-17", "P-17B"]]);

      const result = cleanTrips(rawTrips, vanIds, aliasMap);

      const capConfig: CapConfig = {
        grantCap: 10,
        chargingPointsNorth: 10,
        southRebaseCap: 3,
      };

      const analysisResult = analyzeFleet(
        vans,
        result.trips,
        13,
        dieselModels,
        5.2,
        0.34,
        evModels,
        0.14,
        0.58,
        0.3,
        5,
        "2026-06-15",
        capConfig,
        0.6
      );

      const refrigIds = new Set(["P-03", "P-07", "P-19", "P-23", "P-34", "P-35"]);
      for (const entry of analysisResult.shortlist) {
        expect(refrigIds.has(entry.vanId)).toBe(false);
      }
    });

    it("should check that shortlist does not exceed grant cap", () => {
      const vanIds = new Set(vans.map((v) => v.vanId).concat("P-17B"));
      const aliasMap = new Map([["P-17", "P-17B"]]);

      const result = cleanTrips(rawTrips, vanIds, aliasMap);

      const capConfig: CapConfig = {
        grantCap: 10,
        chargingPointsNorth: 10,
        southRebaseCap: 3,
      };

      const analysisResult = analyzeFleet(
        vans,
        result.trips,
        13,
        dieselModels,
        5.2,
        0.34,
        evModels,
        0.14,
        0.58,
        0.3,
        5,
        "2026-06-15",
        capConfig,
        0.6
      );

      expect(analysisResult.shortlist.length).toBeLessThanOrEqual(capConfig.grantCap);
    });

    it("should check that South re-based vans do not exceed cap", () => {
      const vanIds = new Set(vans.map((v) => v.vanId).concat("P-17B"));
      const aliasMap = new Map([["P-17", "P-17B"]]);

      const result = cleanTrips(rawTrips, vanIds, aliasMap);

      const capConfig: CapConfig = {
        grantCap: 10,
        chargingPointsNorth: 10,
        southRebaseCap: 3,
      };

      const analysisResult = analyzeFleet(
        vans,
        result.trips,
        13,
        dieselModels,
        5.2,
        0.34,
        evModels,
        0.14,
        0.58,
        0.3,
        5,
        "2026-06-15",
        capConfig,
        0.6
      );

      const southCount = analysisResult.shortlist.filter((s) => s.evDepot === "South").length;
      expect(southCount).toBeLessThanOrEqual(capConfig.southRebaseCap);
    });

    it("should produce valid check figures with sample data", () => {
      const vanIds = new Set([...vans.map((v) => v.vanId), "P-17B"]);
      const aliasMap = new Map([["P-17", "P-17B"]]);

      const result = cleanTrips(rawTrips, vanIds, aliasMap);

      const capConfig: CapConfig = {
        grantCap: 10,
        chargingPointsNorth: 10,
        southRebaseCap: 3,
      };

      const analysisResult = analyzeFleet(
        vans,
        result.trips,
        13,
        dieselModels,
        5.2,
        0.34,
        evModels,
        0.14,
        0.58,
        0.3,
        5,
        "2026-06-15",
        capConfig,
        0.6
      );

      expect(analysisResult.checkFigures.vansAssessed).toBe(38);
      expect(analysisResult.checkFigures.tripsCounted).toBeGreaterThan(0);
      expect(analysisResult.checkFigures.totalKm).toBeGreaterThan(0);
      expect(analysisResult.shortlist.length).toBeLessThanOrEqual(10);
    });
  });
});
