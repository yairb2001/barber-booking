import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // === עסק ===
  const business = await prisma.business.create({
    data: {
      name: "DOMINANT Barbershop",
      slug: "dominant",
      brandColor: "#D4AF37",
      phone: "050-0000000",
      address: "ישראל",
      about: "מספרת DOMINANT - חווית תספורת ברמה אחרת",
      socialLinks: JSON.stringify({
        instagram: "https://instagram.com/dominant",
        whatsapp: "",
        facebook: "",
        tiktok: "",
      }),
    },
  });

  console.log(`✅ Business created: ${business.name}`);

  // === ספרים ===
  const staffData = [
    { name: "אוריה", sortOrder: 1 },
    { name: "אלמו", sortOrder: 2 },
    { name: "יאיר הרוש", sortOrder: 3 },
    { name: "ישראל", sortOrder: 4 },
    { name: "ניתאי", sortOrder: 5 },
    { name: "יאיר בוחבוט", sortOrder: 6 },
  ];

  const staffMembers = [];
  for (const s of staffData) {
    const staff = await prisma.staff.create({
      data: {
        businessId: business.id,
        name: s.name,
        role: "barber",
        isAvailable: true,
        inQuickPool: true,
        poolPriority: s.sortOrder,
        sortOrder: s.sortOrder,
      },
    });
    staffMembers.push(staff);
  }

  console.log(`✅ ${staffMembers.length} staff members created`);

  // === שעות עבודה ===
  // א-ה (0=ראשון=Sunday, 1=שני, ..., 4=חמישי) 09:00-20:00
  // ו (5=שישי) 08:00-14:00
  // ש (6=שבת) - לא עובד
  for (const staff of staffMembers) {
    for (let day = 0; day <= 6; day++) {
      if (day === 6) {
        // שבת - לא עובד
        await prisma.staffSchedule.create({
          data: {
            staffId: staff.id,
            dayOfWeek: day,
            isWorking: false,
            slots: "[]",
          },
        });
      } else if (day === 5) {
        // שישי
        await prisma.staffSchedule.create({
          data: {
            staffId: staff.id,
            dayOfWeek: day,
            isWorking: true,
            slots: JSON.stringify([{ start: "08:00", end: "14:00" }]),
          },
        });
      } else {
        // ראשון-חמישי
        await prisma.staffSchedule.create({
          data: {
            staffId: staff.id,
            dayOfWeek: day,
            isWorking: true,
            slots: JSON.stringify([{ start: "09:00", end: "20:00" }]),
          },
        });
      }
    }
  }

  console.log("✅ Staff schedules created");

  // === שירותים ===
  const service1 = await prisma.service.create({
    data: {
      businessId: business.id,
      name: "תספורת + זקן",
      price: 90,
      durationMinutes: 30,
      color: "#D4AF37",
      sortOrder: 1,
    },
  });

  const service2 = await prisma.service.create({
    data: {
      businessId: business.id,
      name: "תספורת מספריים",
      price: 130,
      durationMinutes: 45,
      color: "#8B5CF6",
      sortOrder: 2,
    },
  });

  console.log("✅ Services created");

  // === קישור שירותים לספרים ===
  for (const staff of staffMembers) {
    await prisma.staffService.createMany({
      data: [
        { staffId: staff.id, serviceId: service1.id },
        { staffId: staff.id, serviceId: service2.id },
      ],
    });
  }

  console.log("✅ Staff-service links created");

  // === עדכונים ===
  await prisma.announcement.createMany({
    data: [
      {
        businessId: business.id,
        title: "שעות פעילות חג הפסח",
        content: "בימי חול המועד פסח נעבוד בשעות מקוצרות 09:00-16:00. חג שמח!",
        isPinned: true,
        sortOrder: 1,
      },
      {
        businessId: business.id,
        title: "מבצע חבר מביא חבר",
        content: "הביאו חבר וקבלו 20% הנחה על התספורת הבאה! המבצע בתוקף עד סוף החודש.",
        isPinned: false,
        sortOrder: 2,
      },
    ],
  });

  console.log("✅ Announcements created");

  // === מוצרים ===
  await prisma.product.createMany({
    data: [
      {
        businessId: business.id,
        name: "שעווה לעיצוב",
        description: "שעווה מקצועית לעיצוב השיער",
        price: 60,
        sortOrder: 1,
      },
      {
        businessId: business.id,
        name: "שמן לזקן",
        description: "שמן טיפוח מקצועי לזקן",
        price: 75,
        sortOrder: 2,
      },
      {
        businessId: business.id,
        name: "ספריי מלח ים",
        description: "ספריי לטקסטורה טבעית",
        price: 55,
        sortOrder: 3,
      },
    ],
  });

  console.log("✅ Products created");

  // === פורטפוליו / סטוריז (placeholder URLs) ===
  for (const staff of staffMembers.slice(0, 3)) {
    await prisma.portfolioItem.create({
      data: {
        staffId: staff.id,
        imageUrl: `/images/portfolio/${staff.name.replace(/ /g, "-")}.jpg`,
        caption: `עבודה אחרונה של ${staff.name}`,
        sortOrder: 1,
      },
    });
  }

  console.log("✅ Portfolio items created");
  console.log("\n🎉 Seed completed successfully!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
